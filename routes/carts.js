const express = require('express');
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
} = require('../controllers/cartController');

const router = express.Router();

router.route('/')
  .get(getCart)
  .delete(clearCart);

router.route('/items')
  .post(addToCart);

router.route('/items/:productId')
  .put(updateCartItem)
  .delete(removeFromCart);

module.exports = router;