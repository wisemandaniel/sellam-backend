const express = require('express');
const {
  createOrder,
  getMyOrders,
  getOrder,
  updateOrderStatus,
  getOrders
} = require('../controllers/orderController');

const router = express.Router();

router.route('/')
  .post(createOrder)
  .get(getOrders);

router.route('/my-orders')
  .get(getMyOrders);

router.route('/:id')
  .get(getOrder);

router.route('/:id/status')
  .put(updateOrderStatus);

module.exports = router;