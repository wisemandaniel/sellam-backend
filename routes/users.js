const express = require('express');
const {
  getProfile,
  createOrUpdateUser,
  loginUser,
  updateProfile,
  sendOTP,
  resendOTP,
  verifyOTP,
  getVerifiedDevices,
  removeDevice,
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getAllRidersWithStats // NEW IMPORT
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const { handleUploadError, upload } = require('../middleware/upload');
const { uploadProfileImage, deleteProfileImage } = require('../controllers/authController');

const router = express.Router();

// Public routes (no authentication required)
router.post('/profile', createOrUpdateUser); // Create/update user by phone and get token
router.post('/login', loginUser); // Login with phone and get token
router.post('/send-otp', sendOTP); // Send OTP
router.post('/verify-otp', verifyOTP); // Verify OTP
router.post('/resend-otp', resendOTP); // Resend OTP

// Protected routes (authentication required)
router.get('/profile', protect, getProfile); // Only GET profile requires existing auth
router.put('/profile', protect, updateProfile); // Update profile requires authentication
router.get('/devices', protect, getVerifiedDevices); // Get verified devices
router.delete('/devices/:deviceId', protect, removeDevice); // Remove device

// NEW ROUTES FOR FRONTEND ADMIN PANEL
router.get('/', protect, authorize('admin'), getUsers); // Get all users (admin only)

// FIXED: Add multer middleware for file uploads
router.post('/', protect, authorize('admin'), upload.single('profileImage'), handleUploadError, addUser); // Create user (admin only)
router.put('/:id', protect, authorize('admin'), upload.single('profileImage'), handleUploadError, updateUser); // Update user (admin only)

router.delete('/:id', protect, authorize('admin'), deleteUser); // Delete user (admin only)

// NEW ROUTE: Get all riders with complete stats and deliveries
router.get('/admin/riders/stats', protect, authorize('admin'), getAllRidersWithStats); // Get comprehensive rider stats

router.put('/:userId/upload-profile-image', protect, upload.single('profileImage'), handleUploadError, uploadProfileImage);
router.delete('/:userId/profile-image', protect, deleteProfileImage);

module.exports = router;