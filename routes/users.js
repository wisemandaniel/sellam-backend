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
  getAllRidersWithStats,
  getClientById,
  getVendorById, // ← Add this import
  deleteMyAccount
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const { handleUploadError, upload } = require('../middleware/upload');
const { uploadProfileImage, deleteProfileImage } = require('../controllers/authController');

const router = express.Router();

// Public routes (no authentication required)
router.post('/profile', createOrUpdateUser);
router.post('/login', loginUser);
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

// Protected routes (authentication required)
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.get('/devices', protect, getVerifiedDevices);
router.delete('/devices/:deviceId', protect, removeDevice);
// User deletes their own account
router.delete('/me', protect, deleteMyAccount);

// ADMIN PANEL ROUTES
router.get('/', protect,  getUsers);
router.post('/', protect,  upload.single('profileImage'), handleUploadError, addUser);
router.put('/:id', protect,  upload.single('profileImage'), handleUploadError, updateUser);
router.delete('/:id', protect,  deleteUser);

// NEW ADMIN ROUTES
router.get('/admin/riders/stats', protect, authorize('admin'), getAllRidersWithStats);
router.get('/admin/clients/:id', protect, authorize('admin'), getClientById);
router.get('/admin/vendors/:id', protect, authorize('admin'), getVendorById); // ← Add this route

router.put('/:userId/upload-profile-image', protect, upload.single('profileImage'), handleUploadError, uploadProfileImage);
router.delete('/:userId/profile-image', protect, deleteProfileImage);

module.exports = router;