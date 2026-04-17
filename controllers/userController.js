const mongoose = require("mongoose");
const User = require("../models/User");
const Account = require("../models/Account");
const Order = require("../models/Order");
const Store = require("../models/Store");
const Product = require("../models/Product");
const { createClient } = require('@supabase/supabase-js');
const { sendOTP, verifyOTPCode, sendOrderNotification } = require("../services/messageServices");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const DISABLE_OTP_VERIFICATION = process.env.DISABLE_OTP_VERIFICATION === "true";

// --- Helpers ---
const formatPhoneNumber = (phone) => {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("237") && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 9 && /^[6-9]/.test(cleaned)) return `+237${cleaned}`;
  if (cleaned.length === 12) return `+${cleaned}`;
  if (phone.startsWith("+") && phone.length >= 8) return phone;
  throw new Error(`Invalid phone number format: ${phone}`);
};

// Upload profile image to Supabase (unchanged)
const uploadToSupabase = async (file, userId, oldProfileImage = null) => {
  try {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) throw new Error('Only JPEG, PNG, WebP, and GIF images are allowed');
    if (file.size > 5 * 1024 * 1024) throw new Error('Image size must be less than 5MB');
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `profile-${userId}-${Date.now()}.${fileExtension}`;
    const filePath = `profile-photos/${fileName}`;
    const { data, error } = await supabase.storage.from('users').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new Error('Error uploading image: ' + error.message);
    const { data: { publicUrl } } = supabase.storage.from('users').getPublicUrl(filePath);
    if (oldProfileImage && oldProfileImage.includes('supabase.co')) {
      try {
        const oldFileName = oldProfileImage.split('/').pop();
        const oldFilePath = `profile-photos/${oldFileName}`;
        await supabase.storage.from('users').remove([oldFilePath]);
      } catch (e) { console.warn('Could not delete old photo:', e.message); }
    }
    return publicUrl;
  } catch (error) {
    console.error('Upload to Supabase error:', error);
    throw error;
  }
};

// ==================== ADMIN PANEL FUNCTIONS ====================
const getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -verifiedDevices -pendingDeviceVerification')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
};

const addUser = async (req, res) => {
  try {
    const { name, email, phone, role, password, address, vehicleType } = req.body;
    if (!name || !phone || !role) {
      return res.status(400).json({ success: false, message: 'Name, phone, and role are required' });
    }
    const existingUser = await User.findOne({ $or: [{ email: email?.toLowerCase().trim() }, { phone: phone.trim() }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or phone already exists' });
    }
    let profileImageUrl = '';
    if (req.file) {
      try {
        const tempUserId = new mongoose.Types.ObjectId();
        profileImageUrl = await uploadToSupabase(req.file, tempUserId);
      } catch (uploadError) {
        console.error('Profile photo upload failed:', uploadError.message);
      }
    }
    const userData = {
      name: name.trim(),
      phone: phone.trim(),
      role,
      address: address || '',
      vehicleType: vehicleType || 'bike',
      profileImage: profileImageUrl,
      isActive: true,
      phoneVerified: true,
      isProfileComplete: true
    };
    if (email) userData.email = email.toLowerCase().trim();
    if (['admin', 'vendor'].includes(role) && password) userData.password = password;
    const user = await User.create(userData);
    if (profileImageUrl && profileImageUrl.includes('supabase.co')) {
      try {
        const oldFileName = profileImageUrl.split('/').pop();
        const newFileName = `profile-${user._id}-${Date.now()}.${oldFileName.split('.').pop()}`;
        const newFilePath = `profile-photos/${newFileName}`;
        await supabase.storage.from('users').copy(`profile-photos/${oldFileName}`, newFilePath);
        const { data: { publicUrl } } = supabase.storage.from('users').getPublicUrl(newFilePath);
        user.profileImage = publicUrl;
        await user.save();
        await supabase.storage.from('users').remove([`profile-photos/${oldFileName}`]);
      } catch (e) { console.warn('Could not update profile image path:', e.message); }
    }
    if (user.role === 'rider') {
      await Account.create({ user: user._id, vehicleType: user.vehicleType, status: 'active' });
    }
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.verifiedDevices;
    delete userResponse.pendingDeviceVerification;
    res.status(201).json({ success: true, data: userResponse, message: 'User created successfully' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email or phone already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating user: ' + error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const updateData = {};
    let hasValidUpdate = false;
    const { name, email, phone, role, isActive, address, vehicleType, commission } = req.body;
    if (name !== undefined && name !== null && name !== '') { updateData.name = name.trim(); hasValidUpdate = true; }
    if (email !== undefined && email !== null && email !== '') { updateData.email = email.toLowerCase().trim(); hasValidUpdate = true; }
    if (phone !== undefined && phone !== null && phone !== '') { updateData.phone = phone.trim(); hasValidUpdate = true; }
    if (role !== undefined && role !== null && role !== '') { updateData.role = role; hasValidUpdate = true; }
    if (typeof isActive !== 'undefined' && isActive !== null) { updateData.isActive = isActive; hasValidUpdate = true; }
    if (address !== undefined && address !== null && address !== '') { updateData.address = address; hasValidUpdate = true; }
    if (vehicleType !== undefined && vehicleType !== null && vehicleType !== '') { updateData.vehicleType = vehicleType; hasValidUpdate = true; }
    if (commission !== undefined && commission !== null && commission !== '') { updateData.commission = commission; hasValidUpdate = true; }
    if (req.file) {
      try {
        const profileImageUrl = await uploadToSupabase(req.file, user._id, user.profileImage);
        updateData.profileImage = profileImageUrl;
        hasValidUpdate = true;
      } catch (uploadError) {
        console.error('Profile photo upload failed:', uploadError.message);
      }
    }
    if (!hasValidUpdate) {
      return res.status(400).json({ success: false, message: 'At least one valid field must be provided' });
    }
    if (updateData.email || updateData.phone) {
      const conditions = [];
      if (updateData.email) conditions.push({ email: updateData.email });
      if (updateData.phone) conditions.push({ phone: updateData.phone });
      const existingUser = await User.findOne({ $or: conditions, _id: { $ne: req.params.id } });
      if (existingUser) {
        const conflictField = existingUser.email === updateData.email ? 'email' : 'phone';
        return res.status(400).json({ success: false, message: `${conflictField} already taken by another user` });
      }
    }
    user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .select('-password -verifiedDevices -pendingDeviceVerification');
    if (user.role === 'rider' && (updateData.vehicleType || updateData.isActive !== undefined)) {
      await Account.findOneAndUpdate(
        { user: user._id },
        { status: user.isActive ? 'active' : 'inactive', vehicleType: user.vehicleType }
      );
    }
    res.json({ success: true, data: user, message: 'User updated successfully', updatedFields: Object.keys(updateData) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email or phone already taken' });
    }
    res.status(500).json({ success: false, message: 'Error updating user: ' + error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    if (user.profileImage && user.profileImage.includes('supabase.co')) {
      try {
        const fileName = user.profileImage.split('/').pop();
        await supabase.storage.from('users').remove([`profile-photos/${fileName}`]);
      } catch (e) { console.warn('Could not delete profile photo:', e.message); }
    }
    await User.findByIdAndDelete(req.params.id);
    await Account.findOneAndDelete({ user: req.params.id });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
};

// ==================== USER AUTH & PROFILE FUNCTIONS ====================
const createOrUpdateUser = async (req, res) => {
  try {
    const { name, phone, address, role = "client", deviceId, deviceInfo } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone required" });
    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    if (user) {
      const updateData = {};
      if (name) updateData.name = name;
      if (address) updateData.address = address;
      if (role) updateData.role = role;
      user = await User.findOneAndUpdate({ phone: formattedPhone }, updateData, { new: true, runValidators: true });
      if (deviceId) {
        user.addVerifiedDevice(deviceId, deviceInfo || {});
        await user.save();
      }
      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });
      return res.status(200).json({
        success: true,
        data: user,
        account: account || null,
        token,
        message: "Profile updated successfully",
      });
    }
    const existingPending = await User.findOne({ 'pendingPhoneVerification.phone': formattedPhone });
    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: 'Verification already pending for this phone. Please verify or request a new OTP.'
      });
    }
    user = await User.create({
      name: name || "",
      phone: formattedPhone,
      address: address || "",
      role,
      isActive: false,
      phoneVerified: false,
      pendingPhoneVerification: {
        phone: formattedPhone,
        requestedAt: new Date(),
        operation: 'create'
      }
    });
    if (!DISABLE_OTP_VERIFICATION) {
      await sendOTP(formattedPhone);
    }
    return res.status(200).json({
      success: true,
      requiresOtp: true,
      message: 'OTP sent to your phone. Please verify to complete registration.',
      tempUserId: user._id,
      phone: formattedPhone
    });
  } catch (err) {
    console.error("createOrUpdateUser error:", err);
    if (err.code === 11000 && err.keyPattern?.phone) {
      return res.status(400).json({ success: false, message: "Phone already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

const loginUser = async (req, res) => {
  try {
    const { phone, role, deviceId, deviceInfo = {} } = req.body;
    if (!role || !phone || !deviceId) {
      return res.status(400).json({ success: false, message: "Role, phone, and deviceId are required" });
    }
    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    if (!user) {
      user = await User.create({
        phone: formattedPhone,
        role,
        isActive: false,
        phoneVerified: false,
        pendingPhoneVerification: {
          phone: formattedPhone,
          requestedAt: new Date(),
          operation: 'create'
        }
      });
      if (!DISABLE_OTP_VERIFICATION) {
        await sendOTP(formattedPhone);
      }
      return res.json({
        success: true,
        requiresOtp: true,
        message: "New account created. OTP sent for verification.",
        tempUserId: user._id
      });
    }
    if (user.role === 'rider' && !user.isApproved) {
      return res.status(403).json({ success: false, message: "Your rider account is pending admin approval." });
    }
    if (user.role === 'rider') {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive",
          vehicleType: user.vehicleType || "bike",
        });
      }
    }
    if (DISABLE_OTP_VERIFICATION) {
      user.phoneVerified = true;
      user.addVerifiedDevice(deviceId, deviceInfo);
      await user.save();
      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });
      return res.json({
        success: true,
        requiresOtp: false,
        data: user,
        account,
        token,
        message: "Login successful (dev mode)",
      });
    }
    if (!user.phoneVerified) {
      try {
        await sendOTP(formattedPhone);
      } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to send OTP." });
      }
      user.pendingDeviceVerification = { deviceId, deviceInfo, phone: formattedPhone, requestedAt: new Date() };
      await user.save();
      return res.json({ success: true, requiresOtp: true, message: "Phone not verified. OTP sent." });
    }
    if (!user.isDeviceVerified(deviceId)) {
      try {
        await sendOTP(formattedPhone);
      } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to send OTP." });
      }
      user.pendingDeviceVerification = { deviceId, deviceInfo, phone: formattedPhone, requestedAt: new Date() };
      await user.save();
      return res.json({ success: true, requiresOtp: true, message: "OTP sent for device verification." });
    } else {
      user.addVerifiedDevice(deviceId, deviceInfo);
      await user.save();
      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });
      return res.json({
        success: true,
        requiresOtp: false,
        data: user,
        account,
        token,
        message: "Login successful",
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { phone, otp, deviceId, deviceInfo = {}, operation } = req.body;
    if (!phone || !otp || !deviceId) {
      return res.status(400).json({ success: false, message: "Phone, OTP, and deviceId required" });
    }
    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!DISABLE_OTP_VERIFICATION) {
      const isValid = await verifyOTPCode(formattedPhone, otp);
      if (!isValid) {
        return res.status(400).json({ success: false, message: "Invalid OTP" });
      }
    }
    if (operation === 'register') {
      if (!user.pendingPhoneVerification || user.pendingPhoneVerification.operation !== 'create') {
        return res.status(400).json({ success: false, message: 'No pending registration found' });
      }
      user.phoneVerified = true;
      user.isActive = true;
      user.pendingPhoneVerification = undefined;
      await user.save();
      if (user.role === 'rider') {
        let account = await Account.findOne({ user: user._id });
        if (!account) {
          account = await Account.create({
            user: user._id,
            status: user.isActive ? "active" : "inactive",
            vehicleType: user.vehicleType || "bike",
          });
        }
      }
      user.addVerifiedDevice(deviceId, deviceInfo);
      await user.save();
      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });
      return res.json({
        success: true,
        data: user,
        account,
        token,
        message: DISABLE_OTP_VERIFICATION ? "Registration completed (dev mode)" : "Registration completed successfully",
      });
    }
    if (operation === 'phone_update') {
      if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) return res.status(404).json({ success: false, message: 'User not found' });
      if (!currentUser.pendingPhoneVerification || currentUser.pendingPhoneVerification.operation !== 'update') {
        return res.status(400).json({ success: false, message: 'No pending phone update' });
      }
      const newPhone = currentUser.pendingPhoneVerification.phone;
      const existing = await User.findOne({ phone: newPhone, _id: { $ne: currentUser._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Phone number already in use' });
      }
      currentUser.phone = newPhone;
      currentUser.phoneVerified = true;
      currentUser.pendingPhoneVerification = undefined;
      await currentUser.save();
      currentUser.addVerifiedDevice(deviceId, deviceInfo);
      await currentUser.save();
      return res.json({
        success: true,
        message: 'Phone number updated successfully',
        data: { phone: currentUser.phone }
      });
    }
    user.addVerifiedDevice(deviceId, deviceInfo);
    user.phoneVerified = true;
    await user.save();
    if (user.role === 'rider') {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive",
          vehicleType: user.vehicleType || "bike",
        });
      }
    }
    const token = user.generateAuthToken();
    const account = await Account.findOne({ user: user._id });
    return res.json({
      success: true,
      data: user,
      account,
      token,
      message: DISABLE_OTP_VERIFICATION ? "OTP verified (dev mode)" : "OTP verified successfully",
    });
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const sendOTPRoute = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone required" });
    const formatted = formatPhoneNumber(phone);
    await sendOTP(formatted);
    res.json({ success: true, message: `OTP sent via WhatsApp` });
  } catch (err) {
    console.error("sendOTP error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const resendOTP = async (req, res) => sendOTPRoute(req, res);

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const account = await Account.findOne({ user: user._id });
    if (user.role === 'rider') await user.updateRanking();
    res.json({ success: true, data: user, account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== UPDATED UPDATE PROFILE ====================
const updateProfile = async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      vehicleType,
      licensePlate,
      guardianName,
      guardianPhone,
      idCardFrontUrl,
      idCardBackUrl,
      profileImage,
      isActive,
    } = req.body;

    // Phone change OTP flow (unchanged)
    if (phone && phone !== req.user.phone) {
      const formattedPhone = formatPhoneNumber(phone);
      const existingUser = await User.findOne({ phone: formattedPhone, _id: { $ne: req.user.id } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Phone number already exists' });
      }
      if (!DISABLE_OTP_VERIFICATION) {
        try {
          await sendOTP(formattedPhone);
        } catch (err) {
          return res.status(500).json({ success: false, message: "Failed to send OTP to new number" });
        }
      }
      await User.findByIdAndUpdate(req.user.id, {
        pendingPhoneVerification: {
          phone: formattedPhone,
          requestedAt: new Date(),
          operation: 'update'
        }
      });
      return res.status(200).json({
        success: true,
        requiresOtp: true,
        message: 'OTP sent to new phone number. Please verify to complete the change.'
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name?.trim();
    if (address !== undefined) updateData.address = address?.trim();
    if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
    if (licensePlate !== undefined) updateData.licensePlate = vehicleType === 'car' ? licensePlate : "";
    if (guardianName !== undefined) updateData.guardianName = guardianName?.trim();
    if (guardianPhone !== undefined) updateData.guardianPhone = guardianPhone?.trim();
    if (idCardFrontUrl !== undefined) updateData.idCardFrontUrl = idCardFrontUrl;
    if (idCardBackUrl !== undefined) updateData.idCardBackUrl = idCardBackUrl;
    if (profileImage !== undefined) updateData.profileImage = profileImage;
    if (typeof isActive !== 'undefined') updateData.isActive = isActive === true;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    let user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Recompute profile completeness (name, address, phone)
    user.checkProfileComplete();
    await user.save();

    let account = await Account.findOne({ user: user._id });
    if (account) {
      account.status = user.isActive ? "active" : "inactive";
      await account.save();
    } else if (user.role === "rider") {
      account = await Account.create({
        user: user._id,
        vehicleType: user.vehicleType,
        status: user.isActive ? "active" : "inactive",
      });
    }

    return res.json({
      success: true,
      data: user,
      account: account || null,
      message: "Profile updated successfully",
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.phone) {
      return res.status(400).json({ success: false, message: "Phone number already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== DEVICE MANAGEMENT ====================
const getVerifiedDevices = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: user.verifiedDevices || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const removeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.verifiedDevices = user.verifiedDevices.filter(d => d.deviceId !== deviceId);
    await user.save();
    res.json({ success: true, message: "Device removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==================== ADMIN RIDER STATS ====================
const getAllRidersWithStats = async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider' })
      .select('name phone email avatar status createdAt lastLogin isActive address vehicleType licensePlate')
      .lean();
    const riderIds = riders.map(r => r._id);
    const accounts = await Account.find({ user: { $in: riderIds } })
      .select('user totalEarnings totalDeliveries completedDeliveries rejectedDeliveries cancelledDeliveries averageRating totalReviews performanceScore ranking vehicleType vehicleModel licensePlate status online')
      .lean();
    const accountMap = new Map(accounts.map(a => [a.user.toString(), a]));
    const allOrders = await Order.find({ rider: { $in: riderIds } })
      .populate('user', 'name phone')
      .populate({ path: 'items.product', select: 'name images price business', populate: { path: 'business', select: 'name phone address' } })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance')
      .lean();
    const ordersByRider = new Map();
    allOrders.forEach(order => {
      if (order.rider) {
        const rid = order.rider.toString();
        if (!ordersByRider.has(rid)) ordersByRider.set(rid, []);
        ordersByRider.get(rid).push(order);
      }
    });
    const ridersWithStats = riders.map(rider => {
      const riderId = rider._id.toString();
      const account = accountMap.get(riderId);
      const riderOrders = ordersByRider.get(riderId) || [];
      const statusCounts = { pending:0, accepted:0, picked_up:0, delivered:0, cancelled:0, rejected:0 };
      let totalEarnings = 0, completedEarnings = 0, pendingEarnings = 0, thisMonthEarnings = 0, lastMonthEarnings = 0;
      let totalDeliveryTime = 0, completedCount = 0;
      const currentMonth = new Date().getMonth(), currentYear = new Date().getFullYear();
      riderOrders.forEach(order => {
        statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
        const driverShare = Math.round(Number(order.deliveryFee) * 0.75 * 100) / 100;
        if (order.status === 'delivered') {
          totalEarnings += driverShare;
          completedEarnings += driverShare;
          completedCount++;
          if (order.acceptedAt && order.deliveredAt) {
            totalDeliveryTime += (new Date(order.deliveredAt) - new Date(order.acceptedAt)) / (1000 * 60);
          }
          if (order.deliveredAt) {
            const d = new Date(order.deliveredAt);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) thisMonthEarnings += driverShare;
            if (d.getMonth() === currentMonth-1 && d.getFullYear() === currentYear) lastMonthEarnings += driverShare;
          }
        } else if (['accepted','picked_up'].includes(order.status)) {
          pendingEarnings += driverShare;
        }
      });
      const avgDeliveryTime = completedCount ? totalDeliveryTime / completedCount : 0;
      const completionRate = riderOrders.length ? (completedCount / riderOrders.length) * 100 : 0;
      return {
        rider: { id: rider._id, name: rider.name, phone: rider.phone, email: rider.email, avatar: rider.avatar, status: rider.status, isActive: rider.isActive, address: rider.address, vehicleType: rider.vehicleType, licensePlate: rider.licensePlate, joinedDate: rider.createdAt, lastLogin: rider.lastLogin },
        account: account ? { totalEarnings: account.totalEarnings, totalDeliveries: account.totalDeliveries, completedDeliveries: account.completedDeliveries, rejectedDeliveries: account.rejectedDeliveries, cancelledDeliveries: account.cancelledDeliveries, averageRating: account.averageRating, totalReviews: account.totalReviews, performanceScore: account.performanceScore, ranking: account.ranking, vehicleType: account.vehicleType, vehicleModel: account.vehicleModel, licensePlate: account.licensePlate, online: account.online, accountStatus: account.status } : { totalEarnings:0, totalDeliveries:0, completedDeliveries:0, rejectedDeliveries:0, cancelledDeliveries:0, averageRating:0, totalReviews:0, performanceScore:0, ranking:'Bronze', vehicleType:'bike', vehicleModel:'', licensePlate:'', online:false, accountStatus:'inactive' },
        financial: { totalEarnings: Math.round(totalEarnings*100)/100, completedEarnings: Math.round(completedEarnings*100)/100, pendingEarnings: Math.round(pendingEarnings*100)/100, thisMonthEarnings: Math.round(thisMonthEarnings*100)/100, lastMonthEarnings: Math.round(lastMonthEarnings*100)/100, estimatedCommissionRate:'75%', averageEarningPerDelivery: completedCount ? Math.round((completedEarnings/completedCount)*100)/100 : 0 },
        performance: { totalOrders: riderOrders.length, completedOrders: completedCount, completionRate: Math.round(completionRate*100)/100, averageDeliveryTime: Math.round(avgDeliveryTime*100)/100, statusBreakdown: statusCounts, acceptanceRate: riderOrders.length ? Math.round(((riderOrders.length-statusCounts.rejected)/riderOrders.length)*100*100)/100 : 0 },
        deliveries: { total: riderOrders.length, orders: riderOrders.map(order => ({ id: order._id, orderNumber: order.orderNumber, type: order.type, status: order.status, total: order.total, deliveryFee: order.deliveryFee, riderEarnings: Math.round(Number(order.deliveryFee)*0.75*100)/100, customer: { name: order.user?.name || 'Customer', phone: order.user?.phone || order.phone }, deliveryAddress: order.deliveryAddress, paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod, distance: order.distance, createdAt: order.createdAt, acceptedAt: order.acceptedAt, pickedUpAt: order.pickedUpAt, deliveredAt: order.deliveredAt, cancelledAt: order.cancelledAt })) },
        analytics: { deliveriesThisMonth: riderOrders.filter(o => o.status==='delivered' && o.deliveredAt && new Date(o.deliveredAt).getMonth()===currentMonth && new Date(o.deliveredAt).getFullYear()===currentYear).length, deliveriesLastMonth: riderOrders.filter(o => o.status==='delivered' && o.deliveredAt && new Date(o.deliveredAt).getMonth()===currentMonth-1 && new Date(o.deliveredAt).getFullYear()===currentYear).length, activeDays: [...new Set(riderOrders.filter(o=>o.deliveredAt).map(o=>new Date(o.deliveredAt).toDateString()))].length, averageDailyDeliveries: completedCount ? Math.round((completedCount / Math.max([...new Set(riderOrders.filter(o=>o.deliveredAt).map(o=>new Date(o.deliveredAt).toDateString()))].length, 1)) * 100)/100 : 0 }
      };
    });
    ridersWithStats.sort((a,b) => b.financial.totalEarnings - a.financial.totalEarnings);
    const platformStats = { totalRiders: ridersWithStats.length, activeRiders: ridersWithStats.filter(r=>r.account.online && r.rider.isActive).length, totalCompletedDeliveries: ridersWithStats.reduce((s,r)=>s+r.performance.completedOrders,0), totalPlatformEarnings: ridersWithStats.reduce((s,r)=>s+r.financial.totalEarnings,0), averageCompletionRate: ridersWithStats.length ? Math.round(ridersWithStats.reduce((s,r)=>s+r.performance.completionRate,0)/ridersWithStats.length*100)/100 : 0, topPerformer: ridersWithStats[0]?.rider.name || 'N/A' };
    res.json({ success: true, data: { platformStats, riders: ridersWithStats, summary: { totalRiders: platformStats.totalRiders, activeRiders: platformStats.activeRiders, totalEarnings: platformStats.totalPlatformEarnings, totalDeliveries: platformStats.totalCompletedDeliveries } }, message: `Retrieved stats for ${ridersWithStats.length} riders` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch rider statistics', error: error.message });
  }
};

// ==================== ADMIN CLIENT DETAILS ====================
const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid client ID' });
    const client = await User.findById(id).select('-password -verifiedDevices -pendingDeviceVerification').lean();
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!['client','customer'].includes(client.role)) return res.status(400).json({ success: false, message: 'User is not a client' });
    let orderQuery = { user: new mongoose.Types.ObjectId(id) };
    if (status && status !== 'all') {
      if (status === 'active') orderQuery.status = { $in: ['pending','accepted','picked_up'] };
      else if (status === 'completed') orderQuery.status = 'delivered';
      else if (status === 'cancelled') orderQuery.status = 'cancelled';
      else orderQuery.status = status;
    }
    let orders = await Order.find(orderQuery)
      .populate('rider', 'name phone')
      .populate({ path: 'items.product', select: 'name images price featuredImage business', populate: { path: 'business', select: 'name phone address deliveryTime' } })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance rider')
      .sort({ createdAt: -1 })
      .lean();
    if (orders.length === 0) {
      const phoneQuery = { phone: client.phone };
      if (status && status !== 'all') {
        if (status === 'active') phoneQuery.status = { $in: ['pending','accepted','picked_up'] };
        else if (status === 'completed') phoneQuery.status = 'delivered';
        else if (status === 'cancelled') phoneQuery.status = 'cancelled';
        else phoneQuery.status = status;
      }
      orders = await Order.find(phoneQuery)
        .populate('rider', 'name phone')
        .populate({ path: 'items.product', select: 'name images price featuredImage business', populate: { path: 'business', select: 'name phone address deliveryTime' } })
        .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance rider user')
        .sort({ createdAt: -1 })
        .lean();
    }
    const pageNum = parseInt(page), limitNum = parseInt(limit);
    const paginatedOrders = orders.slice((pageNum-1)*limitNum, pageNum*limitNum);
    const totalOrders = orders.length;
    const allOrders = await Order.find({ $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] }).lean();
    const financialStats = await Order.aggregate([
      { $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] } },
      { $group: { _id: null, totalLifetimeSpent: { $sum: { $cond: [{ $eq: ['$status','delivered'] }, '$total', 0] } }, totalCompletedOrders: { $sum: { $cond: [{ $eq: ['$status','delivered'] }, 1, 0] } }, totalPendingPayment: { $sum: { $cond: [{ $and: [{ $eq: ['$status','delivered'] }, { $eq: ['$paymentStatus','unpaid'] }] }, '$total', 0] } }, totalPaidAmount: { $sum: { $cond: [{ $and: [{ $eq: ['$status','delivered'] }, { $eq: ['$paymentStatus','paid'] }] }, '$total', 0] } } } }
    ]);
    const financialData = financialStats[0] || { totalLifetimeSpent:0, totalCompletedOrders:0, totalPendingPayment:0, totalPaidAmount:0 };
    const orderStats = await Order.aggregate([
      { $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const statusCounts = { pending:0, accepted:0, picked_up:0, delivered:0, cancelled:0, rejected:0, total: allOrders.length };
    orderStats.forEach(s => { if (statusCounts.hasOwnProperty(s._id)) statusCounts[s._id] = s.count; });
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30);
    const recentActivity = allOrders.filter(o => new Date(o.createdAt) >= thirtyDaysAgo).length;
    const clientData = { id: client._id, name: client.name, phone: client.phone, email: client.email || 'Not provided', profileImage: client.profileImage || '', address: client.address || 'Not provided', role: client.role, isActive: client.isActive, phoneVerified: client.phoneVerified, isProfileComplete: client.isProfileComplete, joinedDate: client.createdAt, lastLogin: client.lastLogin || client.createdAt, preferences: { defaultDeliveryAddress: client.defaultDeliveryAddress || client.address, notificationEnabled: client.notificationEnabled !== false, smsNotifications: client.smsNotifications !== false } };
    const formattedOrders = paginatedOrders.map(order => ({ id: order._id, orderNumber: order.orderNumber, type: order.type, status: order.status, total: order.total, deliveryFee: order.deliveryFee, subtotal: order.subtotal, paymentStatus: order.paymentStatus || 'unpaid', paymentMethod: order.paymentMethod || 'cash', distance: order.distance || 0, rider: order.rider ? { name: order.rider.name, phone: order.rider.phone } : null, deliveryAddress: order.deliveryAddress, phone: order.phone, notes: order.notes || '', createdAt: order.createdAt, acceptedAt: order.acceptedAt, pickedUpAt: order.pickedUpAt, deliveredAt: order.deliveredAt, cancelledAt: order.cancelledAt, rejectedAt: order.rejectedAt, items: order.type === 'business' ? (order.items || []).map(item => ({ name: item.product?.name || 'Product not found', price: item.price, quantity: item.quantity, business: item.product?.business?.name || 'Business not found' })) : undefined, errandItems: order.errandItems, ticketData: order.ticketData, deliveryData: order.deliveryData }));
    const statistics = {
      orders: statusCounts,
      financial: { lifetimeSpent: Math.round(financialData.totalLifetimeSpent*100)/100, averageOrderValue: financialData.totalCompletedOrders ? Math.round((financialData.totalLifetimeSpent/financialData.totalCompletedOrders)*100)/100 : 0, completedOrders: financialData.totalCompletedOrders, pendingPayment: Math.round(financialData.totalPendingPayment*100)/100, paidAmount: Math.round(financialData.totalPaidAmount*100)/100, paymentEfficiency: financialData.totalLifetimeSpent ? Math.round((financialData.totalPaidAmount/financialData.totalLifetimeSpent)*10000)/100 : 0, preferredPaymentMethod: (await Order.aggregate([{ $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] } }, { $group: { _id: '$paymentMethod', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 1 }]))[0]?._id || 'cash' },
      activity: { totalOrders: allOrders.length, recentActivity, firstOrder: allOrders.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))[0]?.createdAt || null, lastOrder: allOrders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0]?.createdAt || null, orderFrequency: (() => { if (allOrders.length<2) return 'N/A'; const first = new Date(allOrders.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))[0].createdAt); const last = new Date(allOrders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0].createdAt); const days = (last-first)/(1000*60*60*24); const freq = allOrders.length / Math.max(days,1); if (freq>=1) return 'Daily'; if (freq>=0.5) return 'Every 2 days'; if (freq>=0.14) return 'Weekly'; if (freq>=0.033) return 'Monthly'; return 'Occasional'; })() },
      preferences: { favoriteOrderType: (await Order.aggregate([{ $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 1 }]))[0]?._id || 'business', averageDeliveryDistance: (await Order.aggregate([{ $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }], distance: { $exists: true, $gt: 0 } } }, { $group: { _id: null, avg: { $avg: '$distance' } } }]))[0]?.avg || 0, mostCommonDeliveryAddress: (await Order.aggregate([{ $match: { $or: [{ user: new mongoose.Types.ObjectId(id) }, { phone: client.phone }] } }, { $group: { _id: '$deliveryAddress', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 1 }]))[0]?._id || 'No address data' },
      dataSource: { byUserId: await Order.countDocuments({ user: new mongoose.Types.ObjectId(id) }), byPhone: await Order.countDocuments({ phone: client.phone }), totalCombined: allOrders.length }
    };
    res.json({ success: true, data: { client: clientData, statistics, orders: { data: formattedOrders, pagination: { current: pageNum, pages: Math.ceil(totalOrders/limitNum), total: totalOrders, hasNext: pageNum < Math.ceil(totalOrders/limitNum), hasPrev: pageNum > 1 } } }, message: `Retrieved details for client ${client.name}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch client details', error: error.message });
  }
};

// ==================== ADMIN VENDOR DETAILS ====================
const getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
    const vendor = await User.findById(id).select('-password -verifiedDevices -pendingDeviceVerification').lean();
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    if (vendor.role !== 'vendor') return res.status(400).json({ success: false, message: 'User is not a vendor' });
    const businesses = await Store.find({ owner: id }).select('name description category address phone email logo images isActive isVerified deliveryFee deliveryTime openingHours coordinates createdAt').sort({ createdAt: -1 }).lean();
    const businessIds = businesses.map(b => b._id);
    const products = await Product.find({ business: { $in: businessIds } }).select('name description price discount category images featuredImage inStock isActive createdAt').populate('business', 'name').lean();
    const pageNum = parseInt(page), limitNum = parseInt(limit);
    const skip = (pageNum-1)*limitNum;
    const vendorOrders = await Order.aggregate([
      { $match: { type: 'business', status: { $in: ['delivered','accepted','picked_up'] } } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDetails' } },
      { $unwind: '$productDetails' },
      { $match: { 'productDetails.business': { $in: businessIds } } },
      { $group: { _id: '$_id', orderNumber: { $first: '$orderNumber' }, status: { $first: '$status' }, total: { $first: '$total' }, deliveryFee: { $first: '$deliveryFee' }, subtotal: { $first: '$subtotal' }, paymentStatus: { $first: '$paymentStatus' }, paymentMethod: { $first: '$paymentMethod' }, deliveryAddress: { $first: '$deliveryAddress' }, phone: { $first: '$phone' }, createdAt: { $first: '$createdAt' }, acceptedAt: { $first: '$acceptedAt' }, deliveredAt: { $first: '$deliveredAt' }, items: { $push: '$items' }, productDetails: { $push: '$productDetails' } } },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    ]);
    const totalOrdersCount = (await Order.aggregate([
      { $match: { type: 'business', status: { $in: ['delivered','accepted','picked_up'] } } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDetails' } },
      { $unwind: '$productDetails' },
      { $match: { 'productDetails.business': { $in: businessIds } } },
      { $group: { _id: '$_id' } },
      { $count: 'total' }
    ]))[0]?.total || 0;
    const vendorStats = await Order.aggregate([
      { $match: { type: 'business', status: { $in: ['delivered','accepted','picked_up','cancelled'] } } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDetails' } },
      { $unwind: '$productDetails' },
      { $match: { 'productDetails.business': { $in: businessIds } } },
      { $group: { _id: '$status', orderCount: { $sum: 1 }, totalRevenue: { $sum: { $multiply: ['$items.price','$items.quantity'] } }, totalProductsSold: { $sum: '$items.quantity' } } }
    ]);
    const totalRevenueResult = await Order.aggregate([
      { $match: { type: 'business', status: 'delivered' } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDetails' } },
      { $unwind: '$productDetails' },
      { $match: { 'productDetails.business': { $in: businessIds } } },
      { $group: { _id: null, totalRevenue: { $sum: { $multiply: ['$items.price','$items.quantity'] } }, totalProductsSold: { $sum: '$items.quantity' }, totalOrders: { $sum: 1 } } }
    ]);
    const revenueData = totalRevenueResult[0] || { totalRevenue:0, totalProductsSold:0, totalOrders:0 };
    const statusCounts = { delivered:0, accepted:0, picked_up:0, cancelled:0, total: totalOrdersCount };
    vendorStats.forEach(s => { if (statusCounts.hasOwnProperty(s._id)) statusCounts[s._id] = s.orderCount; });
    const businessStats = businesses.map(b => {
      const busProducts = products.filter(p => p.business._id.toString() === b._id.toString());
      const active = busProducts.filter(p => p.isActive).length;
      const outStock = busProducts.filter(p => !p.inStock).length;
      const busOrders = vendorOrders.filter(o => o.productDetails.some(pd => pd.business.toString() === b._id.toString()));
      return { id: b._id, name: b.name, category: b.category, isActive: b.isActive, isVerified: b.isVerified, totalProducts: busProducts.length, activeProducts: active, outOfStockProducts: outStock, totalOrders: busOrders.length, deliveryFee: b.deliveryFee, deliveryTime: b.deliveryTime, joinedDate: b.createdAt };
    });
    const vendorData = { id: vendor._id, name: vendor.name, phone: vendor.phone, email: vendor.email || 'Not provided', profileImage: vendor.profileImage || '', address: vendor.address || 'Not provided', role: vendor.role, isActive: vendor.isActive, phoneVerified: vendor.phoneVerified, isProfileComplete: vendor.isProfileComplete, joinedDate: vendor.createdAt, lastLogin: vendor.lastLogin || vendor.createdAt, businessCount: businesses.length, productCount: products.length };
    const formattedBusinesses = businesses.map(b => ({ id: b._id, name: b.name, description: b.description, category: b.category, address: b.address, phone: b.phone, email: b.email, logo: b.logo || '', images: b.images || [], isActive: b.isActive, isVerified: b.isVerified, deliveryFee: b.deliveryFee, deliveryTime: b.deliveryTime, openingHours: b.openingHours || {}, coordinates: b.coordinates || {}, createdAt: b.createdAt, statistics: { totalProducts: products.filter(p=>p.business._id.toString()===b._id.toString()).length, activeProducts: products.filter(p=>p.business._id.toString()===b._id.toString() && p.isActive).length, outOfStockProducts: products.filter(p=>p.business._id.toString()===b._id.toString() && !p.inStock).length, averagePrice: (()=>{ const p = products.filter(p=>p.business._id.toString()===b._id.toString()); if(!p.length) return 0; return Math.round(p.reduce((s,pr)=>s+pr.price,0)/p.length*100)/100; })() } }));
    const formattedProducts = products.map(p => ({ id: p._id, name: p.name, description: p.description, price: p.price, discount: p.discount, finalPrice: p.discount>0 ? Math.round(p.price*(1-p.discount/100)*100)/100 : p.price, category: p.category, images: p.images || [], featuredImage: p.featuredImage || (p.images?.[0] || ''), inStock: p.inStock, isActive: p.isActive, business: { id: p.business._id, name: p.business.name }, createdAt: p.createdAt }));
    const formattedOrders = vendorOrders.map(order => {
      const vendorItems = order.items.filter((_,idx) => order.productDetails[idx] && businessIds.includes(order.productDetails[idx].business.toString()));
      const vendorProducts = order.productDetails.filter(pd => businessIds.includes(pd.business.toString()));
      const vendorSubtotal = vendorItems.reduce((sum,item,idx) => sum + (item.price * (order.items[idx]?.quantity || 0)), 0);
      return { id: order._id, orderNumber: order.orderNumber, status: order.status, total: order.total, deliveryFee: order.deliveryFee, vendorSubtotal: Math.round(vendorSubtotal*100)/100, paymentStatus: order.paymentStatus || 'unpaid', paymentMethod: order.paymentMethod || 'cash', deliveryAddress: order.deliveryAddress, phone: order.phone, createdAt: order.createdAt, acceptedAt: order.acceptedAt, deliveredAt: order.deliveredAt, items: vendorItems.map((item,idx) => ({ name: vendorProducts[idx]?.name || 'Product not found', price: item.price, quantity: order.items.find(i=>i===item)?.quantity || 0, total: item.price * (order.items.find(i=>i===item)?.quantity || 0), business: businesses.find(b=>b._id.toString()===vendorProducts[idx]?.business?.toString())?.name || 'Business not found' })) };
    });
    const statistics = {
      businesses: { total: businesses.length, active: businesses.filter(b=>b.isActive).length, verified: businesses.filter(b=>b.isVerified).length, byCategory: businesses.reduce((acc,b)=>{ acc[b.category] = (acc[b.category]||0)+1; return acc; },{}) },
      products: { total: products.length, active: products.filter(p=>p.isActive).length, outOfStock: products.filter(p=>!p.inStock).length, byCategory: products.reduce((acc,p)=>{ acc[p.category] = (acc[p.category]||0)+1; return acc; },{}) },
      orders: statusCounts,
      financial: { totalRevenue: Math.round(revenueData.totalRevenue*100)/100, totalProductsSold: revenueData.totalProductsSold, averageOrderValue: revenueData.totalOrders ? Math.round((revenueData.totalRevenue/revenueData.totalOrders)*100)/100 : 0, completionRate: totalOrdersCount ? Math.round((statusCounts.delivered/totalOrdersCount)*10000)/100 : 0 },
      performance: { totalOrders: totalOrdersCount, deliveredOrders: statusCounts.delivered, activeOrders: statusCounts.accepted+statusCounts.picked_up, cancellationRate: totalOrdersCount ? Math.round((statusCounts.cancelled/totalOrdersCount)*10000)/100 : 0 }
    };
    res.json({ success: true, data: { vendor: vendorData, statistics, businesses: { data: formattedBusinesses, summary: businessStats }, products: { data: formattedProducts, total: products.length }, orders: { data: formattedOrders, pagination: { current: pageNum, pages: Math.ceil(totalOrdersCount/limitNum), total: totalOrdersCount, hasNext: pageNum < Math.ceil(totalOrdersCount/limitNum), hasPrev: pageNum > 1 } } }, message: `Retrieved details for vendor ${vendor.name}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch vendor details', error: error.message });
  }
};

// ==================== EXPORTS ====================
module.exports = {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getAllRidersWithStats,
  getClientById,
  getVendorById,
  createOrUpdateUser,
  loginUser,
  verifyOTP,
  getProfile,
  updateProfile,
  sendOTP: sendOTPRoute,
  resendOTP,
  getVerifiedDevices,
  removeDevice,
};