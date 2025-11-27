const express = require('express');
const { protect } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const {
  getBusinesses,
  getBusiness,
  addBusiness,
  updateBusiness,
  deleteBusiness,
  uploadLogo,
  uploadCoverImage,
  getBusinessProducts,
  getMyBusinesses
} = require('../controllers/businessController');

const router = express.Router();

// Public routes
router.get('/', getBusinesses);
router.get('/:id', getBusiness);
router.get('/:businessId/products', getBusinessProducts);

// Protected routes
router.get('/my-businesses', protect, getMyBusinesses);
router.post('/', protect, upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), handleUploadError, addBusiness);

router.put('/:id', protect, upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), handleUploadError, updateBusiness);

router.delete('/:id', protect, deleteBusiness);

// Image upload specific routes
router.put('/:id/logo', protect, upload.single('logo'), handleUploadError, uploadLogo);
router.put('/:id/cover', protect, upload.single('coverImage'), handleUploadError, uploadCoverImage);

module.exports = router;