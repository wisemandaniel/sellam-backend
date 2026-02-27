const express = require('express');
const {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  deleteMyOrder,
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
  createOrderForUser,
  getOrdersByBusiness,
  getBusinessOrderStats,
  confirmOrder,
  getOrderByNumber,
  getConfirmedOrders
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
router.get('/:orderNumber', getOrderByNumber);
router.patch('/:orderNumber/cancel', cancelOrder);          // Cancel own order
router.delete('/:orderNumber', deleteMyOrder);                   
// Delete own order (only if cancelled/pending)
router.get('/:id', getOrder); // Customers view specific order
router.patch('/:orderNumber/confirm?pm', confirmOrder);

// ====================
// RIDER/ADMIN ROUTES
// ====================
router.get('/status/confirmed', authorize('rider', 'admin'), getConfirmedOrders);
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

// ====================
// BUSINESS OWNER ROUTES
// ====================
router.get('/business/:businessId', authorize('vendor', 'admin'), getOrdersByBusiness);
router.get('/business/:businessId/stats', authorize('vendor', 'admin'), getBusinessOrderStats);

module.exports = router;