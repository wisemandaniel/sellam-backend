const mongoose = require("mongoose");
const User = require("../models/User");
const Account = require("../models/Account");
const twilio = require("twilio");
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service key for admin operations
);

// --- Twilio Setup ---
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

const DISABLE_OTP_VERIFICATION =
  process.env.DISABLE_OTP_VERIFICATION === "true";

// --- Helpers ---
const formatPhoneNumber = (phone) => {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("237") && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 9 && /^[6-9]/.test(cleaned)) return `+237${cleaned}`;
  if (cleaned.length === 12) return `+${cleaned}`;
  if (phone.startsWith("+") && phone.length >= 8) return phone;
  throw new Error(`Invalid phone number format: ${phone}`);
};

const sendOTPInternal = async (phoneNumber) => {
  if (DISABLE_OTP_VERIFICATION)
    return {
      success: true,
      verification: { status: "development_mode" },
      sid: "dev-mode",
    };
  if (!twilioClient) throw new Error("Twilio not configured");
  if (!process.env.TWILIO_VERIFY_SERVICE_SID)
    throw new Error("Missing TWILIO_VERIFY_SERVICE_SID");

  return await twilioClient.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phoneNumber, channel: "sms" });
};

// Helper function to upload image to Supabase
const uploadToSupabase = async (file, userId, oldProfileImage = null) => {
  try {
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error('Only JPEG, PNG, WebP, and GIF images are allowed');
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Image size must be less than 5MB');
    }

    // Generate unique filename
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `profile-${userId}-${Date.now()}.${fileExtension}`;
    const filePath = `profile-photos/${fileName}`;

    console.log('📤 UPLOAD TO SUPABASE - Uploading file:', {
      userId: userId,
      fileName: fileName,
      fileSize: file.size,
      mimeType: file.mimetype
    });

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('users')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('❌ UPLOAD TO SUPABASE ERROR:', error);
      throw new Error('Error uploading image to storage: ' + error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('users')
      .getPublicUrl(filePath);

    console.log('✅ UPLOAD TO SUPABASE - Image uploaded successfully:', publicUrl);

    // Delete old profile photo if it exists and is from Supabase
    if (oldProfileImage && oldProfileImage.includes('supabase.co')) {
      try {
        const oldUrlParts = oldProfileImage.split('/');
        const oldFileName = oldUrlParts[oldUrlParts.length - 1];
        const oldFilePath = `profile-photos/${oldFileName}`;
        
        const { error: deleteError } = await supabase.storage
          .from('users')
          .remove([oldFilePath]);

        if (deleteError) {
          console.warn('⚠️ UPLOAD TO SUPABASE - Could not delete old profile photo:', deleteError.message);
        } else {
          console.log('🗑️ UPLOAD TO SUPABASE - Deleted old profile photo:', oldFilePath);
        }
      } catch (deleteError) {
        console.warn('⚠️ UPLOAD TO SUPABASE - Error deleting old photo:', deleteError.message);
      }
    }

    return publicUrl;
  } catch (error) {
    console.error('❌ UPLOAD TO SUPABASE FUNCTION ERROR:', error);
    throw error;
  }
};

// ========== ADMIN PANEL FUNCTIONS WITH PROFILE PHOTO SUPPORT ==========

// @desc    Get all users (for admin panel)
// @route   GET /api/users
// @access  Private/Admin
const getUsers = async (req, res) => {
  try {
    console.log('👥 GET USERS - Admin request received');
    
    const users = await User.find()
      .select('-password -verifiedDevices -pendingDeviceVerification')
      .sort({ createdAt: -1 });
    
    console.log(`✅ Found ${users.length} users`);
    
    res.json(users);
  } catch (error) {
    console.error('❌ GET USERS ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
};

// @desc    Create user (for admin panel) - WITH PROFILE PHOTO SUPPORT
// @route   POST /api/users
// @access  Private/Admin
const addUser = async (req, res) => {
  try {
    console.log('👤 ADD USER - Admin request received');
    console.log('👤 ADD USER - Body:', req.body);
    console.log('👤 ADD USER - File:', req.file ? 'Present' : 'Not present');

    const { name, email, phone, role, password, address, vehicleType } = req.body;

    // Validate required fields
    if (!name || !phone || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, and role are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email?.toLowerCase().trim() },
        { phone: phone.trim() }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    let profileImageUrl = '';

    // Upload profile photo if provided
    if (req.file) {
      try {
        // Create a temporary user ID for the upload (will be replaced with actual user ID)
        const tempUserId = new mongoose.Types.ObjectId();
        profileImageUrl = await uploadToSupabase(req.file, tempUserId);
        console.log('✅ Profile photo uploaded during user creation:', profileImageUrl);
      } catch (uploadError) {
        console.error('❌ Profile photo upload failed:', uploadError.message);
        // Continue without profile photo - it's optional
      }
    }

    // Create user
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

    // Add email if provided
    if (email) {
      userData.email = email.toLowerCase().trim();
    }

    // Add password only for admin/vendor roles
    if (['admin', 'vendor'].includes(role) && password) {
      userData.password = password;
    }

    const user = await User.create(userData);

    // If we uploaded a photo with temp ID, now update it with actual user ID
    if (profileImageUrl && profileImageUrl.includes('supabase.co')) {
      try {
        // Extract the file name and create new path with actual user ID
        const urlParts = profileImageUrl.split('/');
        const oldFileName = urlParts[urlParts.length - 1];
        const newFileName = `profile-${user._id}-${Date.now()}.${oldFileName.split('.').pop()}`;
        const newFilePath = `profile-photos/${newFileName}`;

        // Copy the file to new location with correct user ID
        const { data: copyData, error: copyError } = await supabase.storage
          .from('users')
          .copy(`profile-photos/${oldFileName}`, newFilePath);

        if (!copyError) {
          // Get new public URL
          const { data: { publicUrl: newPublicUrl } } = supabase.storage
            .from('users')
            .getPublicUrl(newFilePath);

          // Update user with correct profile image URL
          user.profileImage = newPublicUrl;
          await user.save();

          // Delete the temporary file
          await supabase.storage
            .from('users')
            .remove([`profile-photos/${oldFileName}`]);

          console.log('✅ Profile photo updated with correct user ID');
        }
      } catch (updateError) {
        console.warn('⚠️ Could not update profile photo with correct user ID:', updateError.message);
      }
    }

    // Create account if rider
    if (user.role === 'rider') {
      await Account.create({
        user: user._id,
        vehicleType: user.vehicleType,
        status: 'active'
      });
    }

    // Remove sensitive data from response
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.verifiedDevices;
    delete userResponse.pendingDeviceVerification;

    console.log('✅ USER CREATED:', user.email || user.phone);

    res.status(201).json({
      success: true,
      data: userResponse,
      message: 'User created successfully'
    });

  } catch (error) {
    console.error('❌ ADD USER ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating user: ' + error.message
    });
  }
};

// @desc    Update user (for admin panel) - WITH PROFILE PHOTO SUPPORT
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = async (req, res) => {
  try {
    console.log('✏️ UPDATE USER - Admin request for ID:', req.params.id);
    console.log('✏️ UPDATE USER - Body:', req.body);
    console.log('✏️ UPDATE USER - File:', req.file ? 'Present' : 'Not present');

    // Find user
    let user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize update data
    const updateData = {};
    let hasValidUpdate = false;

    // Handle regular field updates from req.body (JSON data)
    if (req.body && Object.keys(req.body).length > 0) {
      const { name, email, phone, role, isActive, address, vehicleType, commission } = req.body;

      // Build update object with only provided fields
      if (name !== undefined && name !== null && name !== '') {
        updateData.name = name.trim();
        hasValidUpdate = true;
      }

      if (email !== undefined && email !== null && email !== '') {
        updateData.email = email.toLowerCase().trim();
        hasValidUpdate = true;
      }

      if (phone !== undefined && phone !== null && phone !== '') {
        updateData.phone = phone.trim();
        hasValidUpdate = true;
      }

      if (role !== undefined && role !== null && role !== '') {
        updateData.role = role;
        hasValidUpdate = true;
      }

      if (typeof isActive !== 'undefined' && isActive !== null) {
        updateData.isActive = isActive;
        hasValidUpdate = true;
      }

      if (address !== undefined && address !== null && address !== '') {
        updateData.address = address;
        hasValidUpdate = true;
      }

      if (vehicleType !== undefined && vehicleType !== null && vehicleType !== '') {
        updateData.vehicleType = vehicleType;
        hasValidUpdate = true;
      }

      if (commission !== undefined && commission !== null && commission !== '') {
        updateData.commission = commission;
        hasValidUpdate = true;
      }
    }

    // Handle profile photo upload if provided (optional)
    if (req.file) {
      try {
        const profileImageUrl = await uploadToSupabase(req.file, user._id, user.profileImage);
        updateData.profileImage = profileImageUrl;
        hasValidUpdate = true;
        console.log('✅ Profile photo updated during user update');
      } catch (uploadError) {
        console.error('❌ Profile photo upload failed:', uploadError.message);
        // Continue with other updates even if photo upload fails
      }
    }

    // Check if we have at least one valid field to update
    if (!hasValidUpdate) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid field must be provided for update'
      });
    }

    // Check for email/phone conflicts only if they are being updated
    if (updateData.email || updateData.phone) {
      const query = {
        _id: { $ne: req.params.id }
      };

      const conditions = [];
      if (updateData.email) conditions.push({ email: updateData.email });
      if (updateData.phone) conditions.push({ phone: updateData.phone });

      if (conditions.length > 0) {
        query.$or = conditions;
        const existingUser = await User.findOne(query);

        if (existingUser) {
          const conflictField = existingUser.email === updateData.email ? 'email' : 'phone';
          return res.status(400).json({
            success: false,
            message: `${conflictField} already taken by another user`
          });
        }
      }
    }

    // Update user with all changes
    user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password -verifiedDevices -pendingDeviceVerification');

    // Update account status if rider and vehicle type or active status changed
    if (user.role === 'rider' && (updateData.vehicleType || updateData.isActive !== undefined)) {
      await Account.findOneAndUpdate(
        { user: user._id },
        { 
          status: user.isActive ? 'active' : 'inactive',
          vehicleType: user.vehicleType 
        }
      );
    }

    console.log('✅ USER UPDATED:', user.email || user.phone);
    console.log('📋 Updated fields:', Object.keys(updateData));

    res.json({
      success: true,
      data: user,
      message: 'User updated successfully',
      updatedFields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('❌ UPDATE USER ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone already taken by another user'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating user: ' + error.message
    });
  }
};

// @desc    Delete user (for admin panel)
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
  try {
    console.log('🗑️ DELETE USER - Admin request for ID:', req.params.id);
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Don't allow deleting yourself
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // Delete profile photo from Supabase if exists
    if (user.profileImage && user.profileImage.includes('supabase.co')) {
      try {
        const urlParts = user.profileImage.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const filePath = `profile-photos/${fileName}`;
        
        await supabase.storage
          .from('users')
          .remove([filePath]);
        
        console.log('🗑️ Deleted profile photo from storage:', filePath);
      } catch (deleteError) {
        console.warn('⚠️ Could not delete profile photo from storage:', deleteError.message);
      }
    }

    await User.findByIdAndDelete(req.params.id);

    // Also delete associated account if exists
    await Account.findOneAndDelete({ user: req.params.id });

    console.log('✅ USER DELETED:', user.email || user.phone);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('❌ DELETE USER ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
};

// ========== EXISTING FUNCTIONS (KEEP THESE) ==========

//[UPDATED LOGIC] Handles both new user creation and returning existing users
const createOrUpdateUser = async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      role = "client",
      deviceId,
      deviceInfo,
    } = req.body;

    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Phone required" });

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    let isNew = false;

    // --- CREATE OR UPDATE USER ---
    if (user) {
      // Update only the provided fields
      const updateData = {};
      if (name) updateData.name = name;
      if (address) updateData.address = address;
      if (role) updateData.role = role;

      user = await User.findOneAndUpdate(
        { phone: formattedPhone },
        updateData,
        { new: true, runValidators: true }
      );
    } else {
      // Create minimal user with phone; others can be added later
      user = await User.create({
        name: name || "",
        phone: formattedPhone,
        address: address || "",
        role,
      });
      isNew = true;
    }

    // --- SAFELY HANDLE ACCOUNT CREATION ---
    if (user.role === "rider") {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive", // only active if user isActive
          vehicleType: user.vehicleType || "bike",
        });
      }
    }

    // --- ADD DEVICE (if present) ---
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
      message: isNew
        ? "Profile created successfully"
        : "Profile updated successfully",
    });
  } catch (err) {
    console.error("createOrUpdateUser error:", err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// [UPDATED LOGIC] Login with device & optional OTP
const loginUser = async (req, res) => {
  console.log('USER:::: ', req.body);
  
  try {
    const { phone, role, deviceId, deviceInfo = {} } = req.body;
    if (!role) {
      return res
        .status(400)
        .json({ success: false, message: "User role is required" });
    }
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "User Phone number is required" });
    }
    if (!deviceId) {
      return res
        .status(400)
        .json({ success: false, message: "User Device ID is required" });
    }

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });

    // Ensure user exists
    if (!user) {
      user = await User.create({ phone: formattedPhone, role });
    }

    console.log('USER::: ', user);
    

    // Ensure rider account exists (safe version)
    if (role === "rider") {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive",
          vehicleType: user.vehicleType || "bike",
        });
      }
    }

    // OTP handling
    if (DISABLE_OTP_VERIFICATION) {
      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
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

    // OTP required if device unverified
    if (!user.isDeviceVerified(deviceId)) {
      await sendOTPInternal(formattedPhone);
      user.pendingDeviceVerification = {
        deviceId,
        deviceInfo,
        phone: formattedPhone,
        requestedAt: new Date(),
      };
      await user.save();
      return res.json({
        success: true,
        requiresOtp: true,
        message: "OTP sent for verification.",
      });
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
    return res
      .status(500)
      .json({ success: false, message: err.message || "Server error" });
  }
};

// [UPDATED LOGIC] Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { phone, otp, deviceId, deviceInfo = {} } = req.body;
    if (!phone || !otp || !deviceId)
      return res
        .status(400)
        .json({ success: false, message: "Phone, OTP, and deviceId required" });

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // ======== DEV MODE (OTP DISABLED) ========
    if (DISABLE_OTP_VERIFICATION) {
      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
      await user.save();
    }
    // ======== PRODUCTION MODE (OTP ENABLED) ========
    else {
      if (!twilioClient)
        return res
          .status(500)
          .json({ success: false, message: "Twilio not configured" });

      const check = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: formattedPhone, code: otp });

      if (check.status !== "approved")
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
          status: check.status,
        });

      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
      await user.save();
    }

    // ======== ACCOUNT CREATION SAFEGUARD ========
    // Ensures a rider always has one account, never duplicates
    if (user.role === "rider") {
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
      message: DISABLE_OTP_VERIFICATION
        ? "OTP verified (dev mode)"
        : "OTP verified successfully",
    });
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PATCHED] sendOTP & resendOTP (route compatibility)
const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Phone required" });
    const formatted = formatPhoneNumber(phone);
    await sendOTPInternal(formatted);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const resendOTP = async (req, res) => sendOTP(req, res);

// [PRESERVED ORIGINAL]
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    const account = await Account.findOne({ user: user._id });
    if (user.role === 'rider') {
      await user.updateRanking();
    }
    res.json({ success: true, data: user, account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [UPDATED LOGIC] Ensure profile completeness and Keeps user <-> account state fully consistent
const updateProfile = async (req, res) => {
  try {
    const { name, phone, address, vehicleType, licensePlate } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const formattedPhone = formatPhoneNumber(phone);

    // Prevent duplicate phone numbers
    const existingUser = await User.findOne({
      phone: formattedPhone,
      _id: { $ne: req.user.id },
    });
    if (existingUser)
      return res
        .status(400)
        .json({ success: false, message: "Phone number already exists" });

    const updateData = {
      name: name?.trim() || "",
      phone: formattedPhone,
      address: address?.trim() || "",
      vehicleType: vehicleType || "bike",
      licensePlate: vehicleType === "car" ? licensePlate || "" : "",
    };

    let user = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // Recompute completeness and active status
    user.checkProfileComplete();
    user.computeIsActive();
    await user.save(); // triggers post-save hook to sync account

    // Manually ensure account sync (safety double-check)
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
    if (err.code === 11000 && err.keyPattern && err.keyPattern.phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number already exists" });
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc    Get user's verified devices
// @route   GET /api/users/devices
// @access  Private
const getVerifiedDevices = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user.verifiedDevices || [],
    });
  } catch (error) {
    console.error("❌ GET VERIFIED DEVICES - Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// @desc    Remove a verified device
// @route   DELETE /api/users/devices/:deviceId
// @access  Private
const removeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.verifiedDevices) {
      user.verifiedDevices = user.verifiedDevices.filter(
        (device) => device.deviceId !== deviceId
      );
      await user.save();
    }

    res.json({
      success: true,
      message: "Device removed successfully",
    });
  } catch (error) {
    console.error("❌ REMOVE DEVICE - Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Add this import at the top if not already present
const Order = require("../models/Order");

// @desc    Get all riders with complete stats, deliveries, and financial information
// @route   GET /api/users/admin/riders/stats
// @access  Private/Admin
const getAllRidersWithStats = async (req, res) => {
  try {
    console.log('👥 ADMIN - Fetching all riders with complete stats...');

    // Get all users with rider role
    const riders = await User.find({ role: 'rider' })
      .select('name phone email avatar status createdAt lastLogin isActive address vehicleType licensePlate')
      .lean();

    console.log(`✅ Found ${riders.length} riders`);

    // Get accounts for all riders
    const riderIds = riders.map(rider => rider._id);
    const accounts = await Account.find({ user: { $in: riderIds } })
      .select('user totalEarnings totalDeliveries completedDeliveries rejectedDeliveries cancelledDeliveries averageRating totalReviews performanceScore ranking vehicleType vehicleModel licensePlate status online')
      .lean();

    // Create account map for quick lookup
    const accountMap = new Map();
    accounts.forEach(account => {
      accountMap.set(account.user.toString(), account);
    });

    // Get ALL orders for these riders (all statuses)
    const allRiderOrders = await Order.find({ 
      rider: { $in: riderIds } 
    })
    .populate('user', 'name phone')
    .populate({
      path: 'items.product',
      select: 'name images price business',
      populate: {
        path: 'business',
        select: 'name phone address'
      }
    })
    .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance')
    .sort({ createdAt: -1 })
    .lean();

    console.log(`📦 Found ${allRiderOrders.length} total orders for all riders`);

    // Group orders by rider
    const ordersByRider = new Map();
    allRiderOrders.forEach(order => {
      if (order.rider) {
        const riderId = order.rider.toString();
        if (!ordersByRider.has(riderId)) {
          ordersByRider.set(riderId, []);
        }
        ordersByRider.get(riderId).push(order);
      }
    });

    // Calculate comprehensive stats for each rider
    const ridersWithStats = riders.map(rider => {
      const riderId = rider._id.toString();
      const account = accountMap.get(riderId);
      const riderOrders = ordersByRider.get(riderId) || [];
      
      // Count orders by status
      const statusCounts = {
        pending: 0,
        accepted: 0,
        picked_up: 0,
        delivered: 0,
        cancelled: 0,
        rejected: 0
      };

      // Financial calculations
      let totalEarnings = 0;
      let completedEarnings = 0;
      let pendingEarnings = 0;
      let thisMonthEarnings = 0;
      let lastMonthEarnings = 0;

      // Performance metrics
      let totalDeliveryTime = 0;
      let completedCount = 0;
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      riderOrders.forEach(order => {
        // Count by status
        statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

        // Calculate earnings (75% of delivery fee as default commission)
        const driverShare = Math.round(Number(order.deliveryFee) * 0.75 * 100) / 100;
        
        if (order.status === 'delivered') {
          totalEarnings += driverShare;
          completedEarnings += driverShare;
          completedCount++;

          // Calculate delivery time for completed orders
          if (order.acceptedAt && order.deliveredAt) {
            const deliveryTime = (new Date(order.deliveredAt) - new Date(order.acceptedAt)) / (1000 * 60); // in minutes
            totalDeliveryTime += deliveryTime;
          }

          // Monthly earnings
          if (order.deliveredAt) {
            const deliveredDate = new Date(order.deliveredAt);
            if (deliveredDate.getMonth() === currentMonth && deliveredDate.getFullYear() === currentYear) {
              thisMonthEarnings += driverShare;
            }
            if (deliveredDate.getMonth() === currentMonth - 1 && deliveredDate.getFullYear() === currentYear) {
              lastMonthEarnings += driverShare;
            }
          }
        } else if (['accepted', 'picked_up'].includes(order.status)) {
          pendingEarnings += driverShare;
        }
      });

      // Calculate averages
      const averageDeliveryTime = completedCount > 0 ? totalDeliveryTime / completedCount : 0;
      const completionRate = riderOrders.length > 0 ? (completedCount / riderOrders.length) * 100 : 0;

      // Response data structure
      return {
        rider: {
          id: rider._id,
          name: rider.name,
          phone: rider.phone,
          email: rider.email,
          avatar: rider.avatar,
          status: rider.status,
          isActive: rider.isActive,
          address: rider.address,
          vehicleType: rider.vehicleType,
          licensePlate: rider.licensePlate,
          joinedDate: rider.createdAt,
          lastLogin: rider.lastLogin
        },
        account: account ? {
          totalEarnings: account.totalEarnings || totalEarnings,
          totalDeliveries: account.totalDeliveries || riderOrders.length,
          completedDeliveries: account.completedDeliveries || completedCount,
          rejectedDeliveries: account.rejectedDeliveries || statusCounts.rejected,
          cancelledDeliveries: account.cancelledDeliveries || statusCounts.cancelled,
          averageRating: account.averageRating || 0,
          totalReviews: account.totalReviews || 0,
          performanceScore: account.performanceScore || 0,
          ranking: account.ranking || 'Bronze',
          vehicleType: account.vehicleType || 'bike',
          vehicleModel: account.vehicleModel || '',
          licensePlate: account.licensePlate || '',
          online: account.online || false,
          accountStatus: account.status || 'active'
        } : {
          totalEarnings: 0,
          totalDeliveries: 0,
          completedDeliveries: 0,
          rejectedDeliveries: 0,
          cancelledDeliveries: 0,
          averageRating: 0,
          totalReviews: 0,
          performanceScore: 0,
          ranking: 'Bronze',
          vehicleType: 'bike',
          vehicleModel: '',
          licensePlate: '',
          online: false,
          accountStatus: 'inactive'
        },
        financial: {
          totalEarnings: Math.round(totalEarnings * 100) / 100,
          completedEarnings: Math.round(completedEarnings * 100) / 100,
          pendingEarnings: Math.round(pendingEarnings * 100) / 100,
          thisMonthEarnings: Math.round(thisMonthEarnings * 100) / 100,
          lastMonthEarnings: Math.round(lastMonthEarnings * 100) / 100,
          estimatedCommissionRate: '75%', // Default commission rate
          averageEarningPerDelivery: completedCount > 0 ? Math.round((completedEarnings / completedCount) * 100) / 100 : 0
        },
        performance: {
          totalOrders: riderOrders.length,
          completedOrders: completedCount,
          completionRate: Math.round(completionRate * 100) / 100,
          averageDeliveryTime: Math.round(averageDeliveryTime * 100) / 100,
          statusBreakdown: statusCounts,
          acceptanceRate: riderOrders.length > 0 ? 
            Math.round(((riderOrders.length - statusCounts.rejected) / riderOrders.length) * 100 * 100) / 100 : 0
        },
        deliveries: {
          total: riderOrders.length,
          orders: riderOrders.map(order => ({
            id: order._id,
            orderNumber: order.orderNumber,
            type: order.type,
            status: order.status,
            total: order.total,
            deliveryFee: order.deliveryFee,
            riderEarnings: Math.round(Number(order.deliveryFee) * 0.75 * 100) / 100,
            customer: {
              name: order.user?.name || 'Customer',
              phone: order.user?.phone || order.phone
            },
            deliveryAddress: order.deliveryAddress,
            paymentStatus: order.paymentStatus || 'unpaid',
            paymentMethod: order.paymentMethod || 'cash',
            distance: order.distance || 0,
            createdAt: order.createdAt,
            acceptedAt: order.acceptedAt,
            pickedUpAt: order.pickedUpAt,
            deliveredAt: order.deliveredAt,
            cancelledAt: order.cancelledAt,
            // Type-specific data
            ...(order.type === 'business' && {
              items: order.items?.map(item => ({
                name: item.product?.name || 'Product not found',
                price: item.price,
                quantity: item.quantity,
                business: item.product?.business?.name || 'Business not found'
              })) || []
            }),
            ...(order.type === 'errand' && { errandItems: order.errandItems }),
            ...(order.type === 'ticket' && { ticketData: order.ticketData }),
            ...(order.type === 'random' && { deliveryData: order.deliveryData })
          }))
        },
        analytics: {
          deliveriesThisMonth: riderOrders.filter(order => 
            order.status === 'delivered' && 
            order.deliveredAt && 
            new Date(order.deliveredAt).getMonth() === currentMonth &&
            new Date(order.deliveredAt).getFullYear() === currentYear
          ).length,
          deliveriesLastMonth: riderOrders.filter(order => 
            order.status === 'delivered' && 
            order.deliveredAt && 
            new Date(order.deliveredAt).getMonth() === currentMonth - 1 &&
            new Date(order.deliveredAt).getFullYear() === currentYear
          ).length,
          activeDays: [...new Set(riderOrders
            .filter(order => order.deliveredAt)
            .map(order => new Date(order.deliveredAt).toDateString())
          )].length,
          averageDailyDeliveries: completedCount > 0 ? 
            Math.round((completedCount / Math.max([...new Set(riderOrders
              .filter(order => order.deliveredAt)
              .map(order => new Date(order.deliveredAt).toDateString())
            )].length, 1)) * 100) / 100 : 0
        }
      };
    });

    // Sort riders by total earnings (descending)
    ridersWithStats.sort((a, b) => b.financial.totalEarnings - a.financial.totalEarnings);

    // Overall platform stats
    const platformStats = {
      totalRiders: ridersWithStats.length,
      activeRiders: ridersWithStats.filter(r => r.account.online && r.rider.isActive).length,
      totalCompletedDeliveries: ridersWithStats.reduce((sum, rider) => sum + rider.performance.completedOrders, 0),
      totalPlatformEarnings: ridersWithStats.reduce((sum, rider) => sum + rider.financial.totalEarnings, 0),
      averageCompletionRate: ridersWithStats.length > 0 ? 
        Math.round(ridersWithStats.reduce((sum, rider) => sum + rider.performance.completionRate, 0) / ridersWithStats.length * 100) / 100 : 0,
      topPerformer: ridersWithStats.length > 0 ? ridersWithStats[0].rider.name : 'N/A'
    };

    console.log(`📊 Platform Stats: ${platformStats.totalCompletedDeliveries} completed deliveries across ${platformStats.totalRiders} riders`);

    res.json({
      success: true,
      data: {
        platformStats,
        riders: ridersWithStats,
        summary: {
          totalRiders: platformStats.totalRiders,
          activeRiders: platformStats.activeRiders,
          totalEarnings: platformStats.totalPlatformEarnings,
          totalDeliveries: platformStats.totalCompletedDeliveries
        }
      },
      message: `Retrieved complete stats for ${ridersWithStats.length} riders`
    });

  } catch (error) {
    console.error('❌ ADMIN - GET ALL RIDERS WITH STATS ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rider statistics',
      error: error.message
    });
  }
};


// @desc    Get client by ID with complete details and delivery history
// @route   GET /api/users/admin/clients/:id
// @access  Private/Admin
const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    console.log('👤 ADMIN - Fetching client details for ID:', id);

    // Validate client ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format'
      });
    }

    // Find client with basic info
    const client = await User.findById(id)
      .select('-password -verifiedDevices -pendingDeviceVerification')
      .lean();

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Verify it's a client (not rider/admin/vendor)
    if (!['client', 'customer'].includes(client.role)) {
      return res.status(400).json({
        success: false,
        message: 'User is not a client'
      });
    }

    console.log(`🔍 Client found: ${client.name} (${client.phone})`);

    // STRATEGY 1: Find orders by user ID (primary method)
    let orderQuery = { user: new mongoose.Types.ObjectId(id) };
    
    // Add status filter if provided
    if (status && status !== 'all') {
      if (status === 'active') {
        orderQuery.status = { $in: ['pending', 'accepted', 'picked_up'] };
      } else if (status === 'completed') {
        orderQuery.status = 'delivered';
      } else if (status === 'cancelled') {
        orderQuery.status = 'cancelled';
      } else {
        orderQuery.status = status;
      }
    }

    // Get orders by user ID
    let orders = await Order.find(orderQuery)
      .populate('rider', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name phone address deliveryTime'
        }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance rider')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📦 Orders found by user ID: ${orders.length}`);

    // STRATEGY 2: If no orders found by user ID, try by phone number
    if (orders.length === 0) {
      console.log(`🔍 No orders found by user ID, trying phone number: ${client.phone}`);
      
      const phoneOrderQuery = { phone: client.phone };
      if (status && status !== 'all') {
        if (status === 'active') {
          phoneOrderQuery.status = { $in: ['pending', 'accepted', 'picked_up'] };
        } else if (status === 'completed') {
          phoneOrderQuery.status = 'delivered';
        } else if (status === 'cancelled') {
          phoneOrderQuery.status = 'cancelled';
        } else {
          phoneOrderQuery.status = status;
        }
      }

      orders = await Order.find(phoneOrderQuery)
        .populate('rider', 'name phone')
        .populate({
          path: 'items.product',
          select: 'name images price featuredImage business',
          populate: {
            path: 'business',
            select: 'name phone address deliveryTime'
          }
        })
        .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance rider user')
        .sort({ createdAt: -1 })
        .lean();

      console.log(`📦 Orders found by phone number: ${orders.length}`);
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Apply pagination to the final orders list
    const paginatedOrders = orders.slice(skip, skip + limitNum);
    const totalOrders = orders.length;

    // Get comprehensive order statistics
    const allOrders = await Order.find({ 
      $or: [
        { user: new mongoose.Types.ObjectId(id) },
        { phone: client.phone }
      ]
    }).lean();

    console.log(`📊 Total orders found (all methods): ${allOrders.length}`);

    // FIXED: Get proper financial statistics using aggregation
    const financialStats = await Order.aggregate([
      { 
        $match: { 
          $or: [
            { user: new mongoose.Types.ObjectId(id) },
            { phone: client.phone }
          ]
        } 
      },
      {
        $group: {
          _id: null,
          totalLifetimeSpent: { 
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0]
            }
          },
          totalCompletedOrders: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
            }
          },
          totalPendingPayment: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$status', 'delivered'] },
                  { $eq: ['$paymentStatus', 'unpaid'] }
                ]}, 
                '$total', 
                0
              ]
            }
          },
          totalPaidAmount: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$status', 'delivered'] },
                  { $eq: ['$paymentStatus', 'paid'] }
                ]}, 
                '$total', 
                0
              ]
            }
          }
        }
      }
    ]);

    // Get order status breakdown
    const orderStats = await Order.aggregate([
      { 
        $match: { 
          $or: [
            { user: new mongoose.Types.ObjectId(id) },
            { phone: client.phone }
          ]
        } 
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Extract financial data
    const financialData = financialStats[0] || {
      totalLifetimeSpent: 0,
      totalCompletedOrders: 0,
      totalPendingPayment: 0,
      totalPaidAmount: 0
    };

    const lifetimeSpent = financialData.totalLifetimeSpent;
    const completedOrdersCount = financialData.totalCompletedOrders;
    const pendingPayment = financialData.totalPendingPayment;
    const paidAmount = financialData.totalPaidAmount;

    // Calculate average order value
    const averageOrderValue = completedOrdersCount > 0 ? 
      Math.round((lifetimeSpent / completedOrdersCount) * 100) / 100 : 0;

    // Format statistics
    const statusCounts = {
      pending: 0,
      accepted: 0,
      picked_up: 0,
      delivered: 0,
      cancelled: 0,
      rejected: 0,
      total: allOrders.length
    };

    orderStats.forEach(stat => {
      if (statusCounts.hasOwnProperty(stat._id)) {
        statusCounts[stat._id] = stat.count;
      }
    });

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentActivity = allOrders.filter(order => 
      new Date(order.createdAt) >= thirtyDaysAgo
    ).length;

    // Format client data
    const clientData = {
      id: client._id,
      name: client.name,
      phone: client.phone,
      email: client.email || 'Not provided',
      profileImage: client.profileImage || '',
      address: client.address || 'Not provided',
      role: client.role,
      isActive: client.isActive,
      phoneVerified: client.phoneVerified,
      isProfileComplete: client.isProfileComplete,
      joinedDate: client.createdAt,
      lastLogin: client.lastLogin || client.createdAt,
      preferences: {
        defaultDeliveryAddress: client.defaultDeliveryAddress || client.address,
        notificationEnabled: client.notificationEnabled !== false,
        smsNotifications: client.smsNotifications !== false
      }
    };

    // Format orders with detailed information
    const formattedOrders = paginatedOrders.map(order => {
      const baseOrder = {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        distance: order.distance || 0,
        rider: order.rider ? {
          name: order.rider.name,
          phone: order.rider.phone
        } : null,
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || '',
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        rejectedAt: order.rejectedAt,
        // Add user ID from order for debugging
        orderUserId: order.user
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseOrder.items = (order.items || []).map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: item.product?.business ? {
              name: item.product.business.name || 'Business not found',
              phone: item.product.business.phone || '',
              address: item.product.business.address || '',
              deliveryTime: item.product.business.deliveryTime || 'N/A'
            } : null
          }));
          break;

        case 'errand':
          baseOrder.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;
      }

      return baseOrder;
    });

    // Get first and last order dates
    const sortedOrders = allOrders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const firstOrder = sortedOrders[0] || null;
    const lastOrder = sortedOrders[sortedOrders.length - 1] || null;

    // FIXED: Comprehensive client statistics with correct financial data
    const statistics = {
      orders: statusCounts,
      financial: {
        lifetimeSpent: Math.round(lifetimeSpent * 100) / 100,
        averageOrderValue: averageOrderValue,
        completedOrders: completedOrdersCount,
        pendingPayment: Math.round(pendingPayment * 100) / 100, // ACTUAL unpaid delivered orders
        paidAmount: Math.round(paidAmount * 100) / 100, // ACTUAL paid delivered orders
        paymentEfficiency: completedOrdersCount > 0 ? 
          Math.round((paidAmount / lifetimeSpent) * 10000) / 100 : 0, // Percentage paid
        preferredPaymentMethod: await getPreferredPaymentMethod(id, client.phone)
      },
      activity: {
        totalOrders: allOrders.length,
        recentActivity: recentActivity,
        firstOrder: firstOrder?.createdAt || null,
        lastOrder: lastOrder?.createdAt || null,
        orderFrequency: await calculateOrderFrequency(id, client.phone)
      },
      preferences: {
        favoriteOrderType: await getFavoriteOrderType(id, client.phone),
        averageDeliveryDistance: await getAverageDeliveryDistance(id, client.phone),
        mostCommonDeliveryAddress: await getMostCommonDeliveryAddress(id, client.phone)
      },
      dataSource: {
        byUserId: await Order.countDocuments({ user: new mongoose.Types.ObjectId(id) }),
        byPhone: await Order.countDocuments({ phone: client.phone }),
        totalCombined: allOrders.length
      }
    };

    console.log(`✅ ADMIN - Retrieved complete details for client: ${client.name}`);
    console.log(`   📦 Orders: ${allOrders.length} total`);
    console.log(`   💰 Financial: Spent ${lifetimeSpent}, Pending: ${pendingPayment}, Paid: ${paidAmount}`);
    console.log(`   📊 Data source: ${statistics.dataSource.byUserId} by user ID, ${statistics.dataSource.byPhone} by phone`);

    res.json({
      success: true,
      data: {
        client: clientData,
        statistics: statistics,
        orders: {
          data: formattedOrders,
          pagination: {
            current: pageNum,
            pages: Math.ceil(totalOrders / limitNum),
            total: totalOrders,
            hasNext: pageNum < Math.ceil(totalOrders / limitNum),
            hasPrev: pageNum > 1
          }
        }
      },
      message: `Retrieved complete details for client ${client.name} with ${allOrders.length} orders`
    });

  } catch (error) {
    console.error('❌ ADMIN - GET CLIENT BY ID ERROR:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client details',
      error: error.message
    });
  }
};

// Update helper functions to support both user ID and phone
const getPreferredPaymentMethod = async (clientId, clientPhone) => {
  const result = await Order.aggregate([
    { 
      $match: { 
        $or: [
          { user: new mongoose.Types.ObjectId(clientId) },
          { phone: clientPhone }
        ]
      } 
    },
    {
      $group: {
        _id: '$paymentMethod',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);
  
  return result[0]?._id || 'cash';
};

const calculateOrderFrequency = async (clientId, clientPhone) => {
  const orders = await Order.find({
    $or: [
      { user: new mongoose.Types.ObjectId(clientId) },
      { phone: clientPhone }
    ]
  })
  .sort({ createdAt: 1 })
  .select('createdAt')
  .lean();

  if (orders.length < 2) return 'N/A';

  const firstOrder = new Date(orders[0].createdAt);
  const lastOrder = new Date(orders[orders.length - 1].createdAt);
  const daysBetween = (lastOrder - firstOrder) / (1000 * 60 * 60 * 24);
  const frequency = orders.length / Math.max(daysBetween, 1);

  if (frequency >= 1) return 'Daily';
  if (frequency >= 0.5) return 'Every 2 days';
  if (frequency >= 0.14) return 'Weekly';
  if (frequency >= 0.033) return 'Monthly';
  return 'Occasional';
};

const getFavoriteOrderType = async (clientId, clientPhone) => {
  const result = await Order.aggregate([
    { 
      $match: { 
        $or: [
          { user: new mongoose.Types.ObjectId(clientId) },
          { phone: clientPhone }
        ]
      } 
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);
  
  return result[0]?._id || 'business';
};

const getAverageDeliveryDistance = async (clientId, clientPhone) => {
  const result = await Order.aggregate([
    { 
      $match: { 
        $or: [
          { user: new mongoose.Types.ObjectId(clientId) },
          { phone: clientPhone }
        ],
        distance: { $exists: true, $gt: 0 }
      } 
    },
    {
      $group: {
        _id: null,
        averageDistance: { $avg: '$distance' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  return result[0] ? Math.round(result[0].averageDistance * 100) / 100 : 0;
};

const getMostCommonDeliveryAddress = async (clientId, clientPhone) => {
  const result = await Order.aggregate([
    { 
      $match: { 
        $or: [
          { user: new mongoose.Types.ObjectId(clientId) },
          { phone: clientPhone }
        ]
      } 
    },
    {
      $group: {
        _id: '$deliveryAddress',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);
  
  return result[0]?._id || 'No address data';
};


// @desc    Get vendor by ID with complete details and business information
// @route   GET /api/users/admin/vendors/:id
// @access  Private/Admin
const getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    console.log('🏪 ADMIN - Fetching vendor details for ID:', id);

    // Validate vendor ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vendor ID format'
      });
    }

    // Find vendor with basic info
    const vendor = await User.findById(id)
      .select('-password -verifiedDevices -pendingDeviceVerification')
      .lean();

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Verify it's a vendor
    if (vendor.role !== 'vendor') {
      return res.status(400).json({
        success: false,
        message: 'User is not a vendor'
      });
    }

    console.log(`🔍 Vendor found: ${vendor.name} (${vendor.phone})`);

    // Get vendor's businesses
    const Store = require("../models/Store");
    const businesses = await Store.find({ owner: id })
      .select('name description category address phone email logo images isActive isVerified deliveryFee deliveryTime openingHours coordinates createdAt')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`🏪 Businesses found: ${businesses.length}`);

    // Get products for all businesses
    const businessIds = businesses.map(business => business._id);
    const Product = require("../models/Product");
    
    const products = await Product.find({ business: { $in: businessIds } })
      .select('name description price discount category images featuredImage inStock isActive createdAt')
      .populate('business', 'name')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📦 Products found: ${products.length}`);

    // Get orders for all businesses (for analytics)
    const Order = require("../models/Order");
    
    // Calculate pagination for orders
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get orders that include products from vendor's businesses
    const vendorOrders = await Order.aggregate([
      {
        $match: {
          type: 'business',
          status: { $in: ['delivered', 'accepted', 'picked_up'] }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $match: {
          'productDetails.business': { $in: businessIds }
        }
      },
      {
        $group: {
          _id: '$_id',
          orderNumber: { $first: '$orderNumber' },
          status: { $first: '$status' },
          total: { $first: '$total' },
          deliveryFee: { $first: '$deliveryFee' },
          subtotal: { $first: '$subtotal' },
          paymentStatus: { $first: '$paymentStatus' },
          paymentMethod: { $first: '$paymentMethod' },
          deliveryAddress: { $first: '$deliveryAddress' },
          phone: { $first: '$phone' },
          createdAt: { $first: '$createdAt' },
          acceptedAt: { $first: '$acceptedAt' },
          deliveredAt: { $first: '$deliveredAt' },
          items: { $push: '$items' },
          productDetails: { $push: '$productDetails' }
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    ]);

    // Get total orders count for pagination
    const totalOrders = await Order.aggregate([
      {
        $match: {
          type: 'business',
          status: { $in: ['delivered', 'accepted', 'picked_up'] }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $match: {
          'productDetails.business': { $in: businessIds }
        }
      },
      {
        $group: {
          _id: '$_id'
        }
      },
      {
        $count: 'total'
      }
    ]);

    const totalOrdersCount = totalOrders[0]?.total || 0;

    // Calculate vendor statistics
    const vendorStats = await Order.aggregate([
      {
        $match: {
          type: 'business',
          status: { $in: ['delivered', 'accepted', 'picked_up', 'cancelled'] }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $match: {
          'productDetails.business': { $in: businessIds }
        }
      },
      {
        $group: {
          _id: '$status',
          orderCount: { $sum: 1 },
          totalRevenue: { 
            $sum: { 
              $multiply: ['$items.price', '$items.quantity'] 
            } 
          },
          totalProductsSold: { $sum: '$items.quantity' }
        }
      }
    ]);

    // Calculate total revenue and products sold
    const totalRevenueResult = await Order.aggregate([
      {
        $match: {
          type: 'business',
          status: 'delivered'
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $match: {
          'productDetails.business': { $in: businessIds }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { 
            $sum: { 
              $multiply: ['$items.price', '$items.quantity'] 
            } 
          },
          totalProductsSold: { $sum: '$items.quantity' },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    const totalRevenueData = totalRevenueResult[0] || {
      totalRevenue: 0,
      totalProductsSold: 0,
      totalOrders: 0
    };

    // Format status counts
    const statusCounts = {
      delivered: 0,
      accepted: 0,
      picked_up: 0,
      cancelled: 0,
      total: totalOrdersCount
    };

    vendorStats.forEach(stat => {
      if (statusCounts.hasOwnProperty(stat._id)) {
        statusCounts[stat._id] = stat.orderCount;
      }
    });

    // Calculate business statistics
    const businessStats = businesses.map(business => {
      const businessProducts = products.filter(product => 
        product.business._id.toString() === business._id.toString()
      );
      
      const businessOrders = vendorOrders.filter(order => 
        order.productDetails.some(product => 
          product.business.toString() === business._id.toString()
        )
      );

      const activeProducts = businessProducts.filter(product => product.isActive).length;
      const outOfStockProducts = businessProducts.filter(product => !product.inStock).length;

      return {
        id: business._id,
        name: business.name,
        category: business.category,
        isActive: business.isActive,
        isVerified: business.isVerified,
        totalProducts: businessProducts.length,
        activeProducts: activeProducts,
        outOfStockProducts: outOfStockProducts,
        totalOrders: businessOrders.length,
        deliveryFee: business.deliveryFee,
        deliveryTime: business.deliveryTime,
        joinedDate: business.createdAt
      };
    });

    // Format vendor data
    const vendorData = {
      id: vendor._id,
      name: vendor.name,
      phone: vendor.phone,
      email: vendor.email || 'Not provided',
      profileImage: vendor.profileImage || '',
      address: vendor.address || 'Not provided',
      role: vendor.role,
      isActive: vendor.isActive,
      phoneVerified: vendor.phoneVerified,
      isProfileComplete: vendor.isProfileComplete,
      joinedDate: vendor.createdAt,
      lastLogin: vendor.lastLogin || vendor.createdAt,
      businessCount: businesses.length,
      productCount: products.length
    };

    // Format businesses with detailed information
    const formattedBusinesses = businesses.map(business => {
      const businessProducts = products.filter(product => 
        product.business._id.toString() === business._id.toString()
      );

      return {
        id: business._id,
        name: business.name,
        description: business.description,
        category: business.category,
        address: business.address,
        phone: business.phone,
        email: business.email,
        logo: business.logo || '',
        images: business.images || [],
        isActive: business.isActive,
        isVerified: business.isVerified,
        deliveryFee: business.deliveryFee,
        deliveryTime: business.deliveryTime,
        openingHours: business.openingHours || {},
        coordinates: business.coordinates || {},
        createdAt: business.createdAt,
        statistics: {
          totalProducts: businessProducts.length,
          activeProducts: businessProducts.filter(p => p.isActive).length,
          outOfStockProducts: businessProducts.filter(p => !p.inStock).length,
          averagePrice: businessProducts.length > 0 ? 
            Math.round(businessProducts.reduce((sum, p) => sum + p.price, 0) / businessProducts.length * 100) / 100 : 0
        }
      };
    });

    // Format products
    const formattedProducts = products.map(product => ({
      id: product._id,
      name: product.name,
      description: product.description,
      price: product.price,
      discount: product.discount,
      finalPrice: product.discount > 0 ? 
        Math.round(product.price * (1 - product.discount / 100) * 100) / 100 : product.price,
      category: product.category,
      images: product.images || [],
      featuredImage: product.featuredImage || (product.images?.[0] || ''),
      inStock: product.inStock,
      isActive: product.isActive,
      business: {
        id: product.business._id,
        name: product.business.name
      },
      createdAt: product.createdAt
    }));

    // Format orders
    const formattedOrders = vendorOrders.map(order => {
      const vendorItems = order.items.filter((item, index) => {
        const productDetail = order.productDetails[index];
        return productDetail && businessIds.includes(productDetail.business.toString());
      });

      const vendorProductDetails = order.productDetails.filter(product => 
        businessIds.includes(product.business.toString())
      );

      const vendorSubtotal = vendorItems.reduce((sum, item, index) => {
        const productDetail = vendorProductDetails[index];
        if (productDetail) {
          return sum + (item.price * item.quantity);
        }
        return sum;
      }, 0);

      return {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        vendorSubtotal: Math.round(vendorSubtotal * 100) / 100,
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        deliveredAt: order.deliveredAt,
        items: vendorItems.map((item, index) => {
          const productDetail = vendorProductDetails[index];
          return {
            name: productDetail?.name || 'Product not found',
            price: item.price,
            quantity: item.quantity,
            total: item.price * item.quantity,
            business: businesses.find(b => b._id.toString() === productDetail?.business?.toString())?.name || 'Business not found'
          };
        })
      };
    });

    // Comprehensive vendor statistics
    const statistics = {
      businesses: {
        total: businesses.length,
        active: businesses.filter(b => b.isActive).length,
        verified: businesses.filter(b => b.isVerified).length,
        byCategory: businesses.reduce((acc, business) => {
          acc[business.category] = (acc[business.category] || 0) + 1;
          return acc;
        }, {})
      },
      products: {
        total: products.length,
        active: products.filter(p => p.isActive).length,
        outOfStock: products.filter(p => !p.inStock).length,
        byCategory: products.reduce((acc, product) => {
          acc[product.category] = (acc[product.category] || 0) + 1;
          return acc;
        }, {})
      },
      orders: statusCounts,
      financial: {
        totalRevenue: Math.round(totalRevenueData.totalRevenue * 100) / 100,
        totalProductsSold: totalRevenueData.totalProductsSold,
        averageOrderValue: totalRevenueData.totalOrders > 0 ? 
          Math.round((totalRevenueData.totalRevenue / totalRevenueData.totalOrders) * 100) / 100 : 0,
        completionRate: totalOrdersCount > 0 ? 
          Math.round((statusCounts.delivered / totalOrdersCount) * 10000) / 100 : 0
      },
      performance: {
        totalOrders: totalOrdersCount,
        deliveredOrders: statusCounts.delivered,
        activeOrders: statusCounts.accepted + statusCounts.picked_up,
        cancellationRate: totalOrdersCount > 0 ? 
          Math.round((statusCounts.cancelled / totalOrdersCount) * 10000) / 100 : 0
      }
    };

    console.log(`✅ ADMIN - Retrieved complete details for vendor: ${vendor.name}`);
    console.log(`   🏪 Businesses: ${businesses.length}`);
    console.log(`   📦 Products: ${products.length}`);
    console.log(`   📊 Orders: ${totalOrdersCount}`);
    console.log(`   💰 Revenue: ${statistics.financial.totalRevenue}`);

    res.json({
      success: true,
      data: {
        vendor: vendorData,
        statistics: statistics,
        businesses: {
          data: formattedBusinesses,
          summary: businessStats
        },
        products: {
          data: formattedProducts,
          total: products.length
        },
        orders: {
          data: formattedOrders,
          pagination: {
            current: pageNum,
            pages: Math.ceil(totalOrdersCount / limitNum),
            total: totalOrdersCount,
            hasNext: pageNum < Math.ceil(totalOrdersCount / limitNum),
            hasPrev: pageNum > 1
          }
        }
      },
      message: `Retrieved complete details for vendor ${vendor.name}`
    });

  } catch (error) {
    console.error('❌ ADMIN - GET VENDOR BY ID ERROR:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid vendor ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor details',
      error: error.message
    });
  }
};

// Export all functions
module.exports = {
  // Admin panel functions
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getAllRidersWithStats,
  getClientById, // ← Add this
  getVendorById,
  
  // Existing functions
  createOrUpdateUser,
  loginUser,
  verifyOTP,
  getProfile,
  updateProfile,
  sendOTP,
  resendOTP,
  getVerifiedDevices,
  removeDevice,
};