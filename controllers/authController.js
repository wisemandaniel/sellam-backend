const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

    // Check if user is active
    // if (!user.isActive) {
    //   console.log('❌ LOGIN FAILED: Account inactive');
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Account is deactivated. Please contact administrator.'
    //   });
    // }

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
        message: 'Password must be at least 6 characters long'
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
  logout
};