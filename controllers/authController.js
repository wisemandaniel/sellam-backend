const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// @desc    Login user (email/password for admin frontend)
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 LOGIN ATTEMPT:', { email });

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password'
      });
    }

    // Check if user exists with email and has password (admin/vendor roles)
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(),
      role: { $in: ['admin', 'vendor'] }
    }).select('+password'); // Include password field

    if (!user) {
      console.log('❌ LOGIN FAILED: User not found or invalid role');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
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

    // Prepare user data for response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      profileImage: user.profileImage,
      isProfileComplete: user.isProfileComplete,
      isActive: user.isActive,
      lastLogin: user.lastLogin
    };

    console.log('✅ LOGIN SUCCESS:', user.email);

    res.json({
      success: true,
      token,
      user: userData,
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

// @desc    Register new user (admin/vendor)
// @route   POST /api/auth/register
// @access  Private/Admin
const register = async (req, res) => {
  try {
    const { name, email, password, phone, role = 'admin' } = req.body;

    console.log('👤 REGISTRATION ATTEMPT:', { name, email, role });

    // Validation
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, email, password, phone'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { phone: phone.trim() }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    // Validate role
    if (!['admin', 'vendor'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either admin or vendor'
      });
    }

    // Create new user
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      role: role,
      isActive: true,
      phoneVerified: true,
      isProfileComplete: true
    });

    // Generate token
    const token = user.generateAuthToken();

    // User data for response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      profileImage: user.profileImage,
      isProfileComplete: user.isProfileComplete,
      isActive: user.isActive
    };

    console.log('✅ REGISTRATION SUCCESS:', user.email);

    res.status(201).json({
      success: true,
      token,
      user: userData,
      message: 'User registered successfully'
    });

  } catch (error) {
    console.error('❌ REGISTRATION ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating user account'
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
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