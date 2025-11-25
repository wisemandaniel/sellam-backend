const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Business = require('../models/Business');
const mongoose = require('mongoose');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// @desc    Login user (email/password for admin frontend) - UPDATED: Returns full user details
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    console.log('🔐 LOGIN ATTEMPT:', { email, phone });

    // Validation - require either email or phone, and password
    if ((!email && !phone) || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either email or phone, and password'
      });
    }

    // Build query based on provided identifier
    let query = { 
      role: { $in: ['client', 'rider', 'vendor', 'admin'] }
    };

    if (email) {
      query.email = email.toLowerCase().trim();
    } else if (phone) {
      query.phone = phone.trim();
    }

    // Check if user exists and has password
    const user = await User.findOne(query).select('+password');

    if (!user) {
      console.log('❌ LOGIN FAILED: User not found');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user has a password set
    if (!user.password) {
      console.log('❌ LOGIN FAILED: No password set for this account');
      return res.status(401).json({
        success: false,
        message: 'Password not set for this account. Please contact administrator.'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      console.log('❌ LOGIN FAILED: Invalid password');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = user.generateAuthToken();

    // Get complete user details (without password)
    const fullUser = await User.findById(user._id)
      .select('-password -verifiedDevices -pendingDeviceVerification');

    console.log('✅ LOGIN SUCCESS:', {
      id: user._id,
      name: user.name,
      identifier: email || phone
    });

    res.json({
      success: true,
      token,
      user: fullUser, // Return full user object
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ LOGIN ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

// @desc    Register new user - UPDATED: Creates business for vendors
// @route   POST /api/auth/register
// @access  Private/Admin
const register = async (req, res) => {
  let session = null;
  try {
    const { name, email, password, phone, role, address, vehicleType, businessData } = req.body;

    console.log('👤 REGISTRATION ATTEMPT:', { name, email, phone, role });

    // Validation - require at least email OR phone
    if (!name || (!email && !phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and at least one of email or phone'
      });
    }

    // If password is provided, validate it
    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Build query to check for existing users
    const queryConditions = [];
    if (email) queryConditions.push({ email: email.toLowerCase().trim() });
    if (phone) queryConditions.push({ phone: phone.trim() });

    // Check if user already exists with same email or phone
    const existingUser = await User.findOne({
      $or: queryConditions
    });

    if (existingUser) {
      const conflictField = existingUser.email === email?.toLowerCase().trim() ? 'email' : 'phone';
      return res.status(400).json({
        success: false,
        message: `User with this ${conflictField} already exists`
      });
    }

    // Validate role
    if (!['client', 'vendor', 'rider', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either client, rider, vendor or admin'
      });
    }

    // For vendors, validate business data
    if (role === 'vendor') {
      if (!businessData || !businessData.name || !businessData.address || !businessData.phone) {
        return res.status(400).json({
          success: false,
          message: 'For vendor registration, please provide business name, address, and phone'
        });
      }

      // Check if business with same name or phone already exists
      const existingBusiness = await Business.findOne({
        $or: [
          { name: businessData.name.trim() },
          { phone: businessData.phone.trim() }
        ]
      });

      if (existingBusiness) {
        const conflictField = existingBusiness.name === businessData.name.trim() ? 'name' : 'phone';
        return res.status(400).json({
          success: false,
          message: `Business with this ${conflictField} already exists`
        });
      }
    }

    // Start MongoDB session for transaction
    session = await mongoose.startSession();
    session.startTransaction();

    let createdUser = null;
    let business = null;

    try {
      // Prepare user data
      const userData = {
        name: name.trim(),
        role: role,
        isActive: true,
        phoneVerified: true,
        isProfileComplete: true
      };

      // Add optional fields if provided
      if (email) userData.email = email.toLowerCase().trim();
      if (phone) userData.phone = phone.trim();
      if (address) userData.address = address;
      if (vehicleType) userData.vehicleType = vehicleType;
      if (password) userData.password = password;

      // Create new user within transaction
      const user = await User.create([userData], { session });
      createdUser = user[0];

      // Create business if role is vendor
      if (role === 'vendor') {
        const businessInfo = {
          name: businessData.name.trim(),
          description: businessData.description || '',
          address: businessData.address,
          phone: businessData.phone.trim(),
          email: businessData.email || email || '', // Use business email or fallback to user email
          owner: createdUser._id,
          isApproved: businessData.isApproved !== undefined ? businessData.isApproved : false,
          category: businessData.category || 'restaurant',
          deliveryTime: businessData.deliveryTime || '30-45 min',
          deliveryFee: businessData.deliveryFee || 1000,
          minOrderAmount: businessData.minOrderAmount || 0,
          openingHours: businessData.openingHours || { opening: '08:00', closing: '22:00' },
          isOpen: businessData.isOpen !== undefined ? businessData.isOpen : true,
          location: businessData.location || { latitude: 0, longitude: 0 },
          tags: businessData.tags || [],
          socialMedia: businessData.socialMedia || {}
        };

        const createdBusiness = await Business.create([businessInfo], { session });
        business = createdBusiness[0];

        console.log('🏪 BUSINESS CREATED:', {
          id: business._id,
          name: business.name,
          owner: createdUser._id
        });
      }

      // Commit transaction
      await session.commitTransaction();
      console.log('✅ TRANSACTION COMMITTED');

    } catch (transactionError) {
      // Abort transaction if error occurs during database operations
      await session.abortTransaction();
      console.error('❌ TRANSACTION ABORTED:', transactionError);
      throw transactionError;
    } finally {
      // Always end the session
      if (session) {
        session.endSession();
      }
    }

    // Get complete user details (without password) - outside transaction
    const fullUser = await User.findById(createdUser._id)
      .select('-password -verifiedDevices -pendingDeviceVerification');

    // Generate token (only if user has email and password for login)
    let token = null;
    if (createdUser.email && createdUser.password) {
      token = createdUser.generateAuthToken();
    }

    console.log('✅ REGISTRATION SUCCESS:', {
      id: createdUser._id,
      name: createdUser.name,
      email: createdUser.email || 'No email',
      phone: createdUser.phone || 'No phone',
      role: createdUser.role,
      businessCreated: role === 'vendor'
    });

    const response = {
      success: true,
      user: fullUser, // Return full user object
      message: 'User registered successfully'
    };

    // Add business data to response if vendor
    if (role === 'vendor' && business) {
      response.business = business;
      response.message += ' and business created';
    }

    // Only include token if user can login (has email and password)
    if (token) {
      response.token = token;
      response.message += ' - Account is ready for email login';
    } else if (createdUser.phone && !createdUser.email) {
      response.message += ' - Account created with phone only';
    } else if (createdUser.email && !password) {
      response.message += ' - Account created (set password to enable email login)';
    }

    res.status(201).json(response);

  } catch (error) {
    console.error('❌ REGISTRATION ERROR:', error);
    
    // Handle specific error types
    if (error.code === 11000) {
      const field = error.keyPattern?.email ? 'email' : 
                   error.keyPattern?.phone ? 'phone' : 
                   error.keyPattern?.name ? 'business name' : 'field';
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating user account: ' + error.message
    });
  }
};

// @desc    Get current user profile - UPDATED: Returns full user details
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -verifiedDevices -pendingDeviceVerification');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user // Return full user object
    });

  } catch (error) {
    console.error('❌ GET PROFILE ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Get user with password field
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    console.log('✅ PASSWORD CHANGED for user:', user.email);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('❌ CHANGE PASSWORD ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
};

// @desc    Upload or update profile photo
// @route   PUT /api/users/:userId/upload-profile-image
// @access  Private
const uploadProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is authorized to update this profile
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image file'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Only JPEG, PNG, WebP, and GIF images are allowed'
      });
    }

    // Validate file size (5MB limit)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'Image size must be less than 5MB'
      });
    }

    // Generate unique filename
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `profile-${user._id}-${Date.now()}.${fileExtension}`;
    const filePath = `profile-photos/${fileName}`;

    console.log('📤 Uploading profile image to Supabase...', {
      userId: user._id,
      fileName: fileName,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('users')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('❌ SUPABASE UPLOAD ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Error uploading image to storage: ' + error.message
      });
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('users')
      .getPublicUrl(filePath);

    // Delete old profile photo from Supabase if it exists
    if (user.profileImage && user.profileImage.includes('supabase.co')) {
      try {
        const oldUrlParts = user.profileImage.split('/');
        const oldFileName = oldUrlParts[oldUrlParts.length - 1];
        const oldFilePath = `profile-photos/${oldFileName}`;
        
        const { error: deleteError } = await supabase.storage
          .from('users')
          .remove([oldFilePath]);

        if (deleteError) {
          console.warn('⚠️ Could not delete old profile photo from storage:', deleteError.message);
        } else {
          console.log('🗑️ Deleted old profile photo from storage:', oldFilePath);
        }
      } catch (deleteError) {
        console.warn('⚠️ Error deleting old photo from storage:', deleteError.message);
      }
    }

    // Update user profile with new image URL
    user.profileImage = publicUrl;
    await user.save();

    console.log('✅ PROFILE IMAGE UPDATED for user:', user.email);

    res.json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        profileImage: publicUrl,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: publicUrl
        }
      }
    });

  } catch (error) {
    console.error('❌ UPLOAD PROFILE IMAGE ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading profile image: ' + error.message
    });
  }
};

// @desc    Delete profile photo
// @route   DELETE /api/users/:userId/profile-image
// @access  Private
const deleteProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is authorized to update this profile
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.profileImage) {
      return res.status(400).json({
        success: false,
        message: 'No profile image to delete'
      });
    }

    // Delete from Supabase if it's a Supabase URL
    if (user.profileImage.includes('supabase.co')) {
      try {
        const urlParts = user.profileImage.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const filePath = `profile-photos/${fileName}`;
        
        const { error } = await supabase.storage
          .from('users')
          .remove([filePath]);

        if (error) {
          console.warn('⚠️ Could not delete image from storage:', error.message);
        } else {
          console.log('🗑️ Deleted profile photo from storage:', filePath);
        }
      } catch (deleteError) {
        console.warn('⚠️ Error deleting from storage:', deleteError.message);
      }
    }

    // Remove profile image from user
    user.profileImage = '';
    await user.save();

    console.log('✅ PROFILE IMAGE DELETED for user:', user.email);

    res.json({
      success: true,
      message: 'Profile image deleted successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: ''
        }
      }
    });

  } catch (error) {
    console.error('❌ DELETE PROFILE IMAGE ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting profile image'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/:userId/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, phone, address } = req.body;

    // Check if user is authorized to update this profile
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if phone is being changed and if it's already taken
    if (phone && phone !== user.phone) {
      const existingUser = await User.findOne({ 
        phone: phone.trim(),
        _id: { $ne: user._id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
    }

    // Update fields
    if (name) user.name = name.trim();
    if (phone) user.phone = phone.trim();
    if (address) user.address = address;

    await user.save();

    console.log('✅ PROFILE UPDATED for user:', user.email);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });

  } catch (error) {
    console.error('❌ UPDATE PROFILE ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res) => {
  try {
    console.log('✅ LOGOUT: User logged out', req.user.email);
    
    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('❌ LOGOUT ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  login,
  register,
  getMe,
  changePassword,
  uploadProfileImage,
  deleteProfileImage,
  updateProfile,
  logout
};