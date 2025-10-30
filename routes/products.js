const express = require('express');
const { protect } = require('../middleware/auth');
const {
  // Frontend routes
  getAllProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  
  // Existing mobile app routes
  getProducts,
  getProduct,
  getVendorProducts,
  createProduct
} = require('../controllers/productController');

const router = express.Router();

// Frontend API routes (match frontend expectations)
router.get('/', getAllProducts); // GET /api/products (for frontend)
router.post('/', protect, addProduct); // POST /api/products (for frontend)
router.put('/:id', protect, updateProduct); // PUT /api/products/:id (for frontend)
router.delete('/:id', protect, deleteProduct); // DELETE /api/products/:id (for frontend)

// Existing mobile app routes (keep for backward compatibility)
router.get('/mobile', getProducts); // GET /api/products/mobile (with search/filter)
router.get('/:id', getProduct); // GET /api/products/:id
router.get('/vendor/:storeId', protect, getVendorProducts); // GET /api/products/vendor/:storeId
router.post('/create', protect, createProduct); // POST /api/products/create (alias)

module.exports = router;