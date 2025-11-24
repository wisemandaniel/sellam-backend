const express = require('express');
const {
  createOrder,
  getMyOrders,
  getOrder,
  getPendingOrders,
  getMyCompletedDeliveries,
  acceptDelivery,
  rejectDelivery,
  getMyActiveDeliveries,
  updateOrderStatus,
  // NEW ADMIN ENDPOINTS
  getAllOrders,
  updateOrder,
  getRiderOrders,
  deleteOrder,
  createOrderForUser
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
router.get('/my-deliveries/completed', authorize('rider', 'admin'), getMyCompletedDeliveries);
router.patch('/:orderId/accept', authorize('rider', 'admin'), acceptDelivery);
router.patch('/:orderId/reject', authorize('rider', 'admin'), rejectDelivery);
router.patch('/:orderId/status', updateOrderStatus);

// ====================
// ADMIN ONLY ROUTES (for frontend admin panel)
// ====================
router.post('/admin/create', authorize('admin'), createOrderForUser); // Admin creates order for user
router.get('/', authorize('admin'), getAllOrders); // Get all orders (admin panel)
router.get('/rider/:riderId', authorize('admin'), getRiderOrders); 
router.put('/:id', authorize('admin'), updateOrder); // Update order (admin panel)
router.delete('/:id', authorize('admin'), deleteOrder); // Delete order (admin panel)

module.exports = router;