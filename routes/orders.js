const express = require('express');
const {
  createOrder,
  getMyOrders,
  getOrder,
  getPendingOrders,
  getMyCompletedDeliveries, // ✅ Import new function
  acceptDelivery,
  rejectDelivery,
  getMyActiveDeliveries,
  updateOrderStatus
} = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// ====================
// CUSTOMER ROUTES
// ====================
router.post('/', createOrder); // Customers create orders
router.get('/my-orders', getMyOrders); // Customers view their orders
router.get('/:id', getOrder); // Customers view specific order

// ====================
// RIDER/ADMIN ROUTES
// ====================
router.get('/status/pending', authorize('rider', 'admin'), getPendingOrders);
router.get('/my-deliveries/active', authorize('rider', 'admin'), getMyActiveDeliveries);
router.get('/my-deliveries/completed', authorize('rider', 'admin'), getMyCompletedDeliveries); // ✅ New endpoint
router.patch('/:orderId/accept', authorize('rider', 'admin'), acceptDelivery);
router.patch('/:orderId/reject', authorize('rider', 'admin'), rejectDelivery);
router.patch('/:orderId/status', authorize('rider', 'admin'), updateOrderStatus);

module.exports = router;