const express = require('express');
const {
  getProfile,
  createOrUpdateUser,
  loginUser,
  updateProfile,
  sendOTP,
  resendOTP,
  verifyOTP
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Public routes (no authentication required)
router.post('/profile', createOrUpdateUser); // Create/update user by phone and get token
router.post('/login', loginUser); // Login with phone and get token

// Protected routes (authentication required)
router.get('/profile', protect, getProfile); // Only GET profile requires existing auth
router.put('/profile', protect, updateProfile); // Update profile requires authentication
router.post('/send-otp', sendOTP); // Send OTP
router.post('/verify-otp', verifyOTP); // Verify OTP
router.post('/resend-otp', resendOTP); // Resend OTP

module.exports = router;