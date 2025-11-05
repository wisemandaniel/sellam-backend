const express = require('express');
const router = express.Router();
const { upload, handleUploadError } = require('../middleware/upload'); 
const {
  getAllProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
  addProductImages,
  removeProductImage,
  getProducts,
  getVendorProducts
} = require('../controllers/productController');

const uploadMiddleware = [
  upload.array('images', 10), // 'images' field, max 10 files
  handleUploadError
];

router.post('/', uploadMiddleware, addProduct);
router.put('/:id', uploadMiddleware, updateProduct);
router.put('/:id/images', uploadMiddleware, addProductImages);

// Routes without file uploads
router.get('/', getAllProducts);
router.get('/:id', getProduct);
router.delete('/:id', deleteProduct);
router.delete('/:id/images', removeProductImage);

// Mobile app compatibility routes
router.get('/mobile/products', getProducts);
router.get('/mobile/vendor/:storeId/products', getVendorProducts);

module.exports = router;