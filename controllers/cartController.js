const Cart = require('../models/Cart');
const Product = require('../models/Product');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
const getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user.id })
      .populate('items.product')
      .populate('store');

    if (!cart) {
      cart = await Cart.create({ user: req.user.id, items: [] });
    }

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Add item to cart
// @route   POST /api/cart/items
// @access  Private
const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    const product = await Product.findById(productId).populate('store');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (!product.inStock) {
      return res.status(400).json({ message: 'Product is out of stock' });
    }

    let cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      cart = await Cart.create({ 
        user: req.user.id, 
        items: [{ product: productId, quantity }],
        store: product.store._id
      });
    } else {
      // Check if adding product from different store
      if (cart.store && cart.store.toString() !== product.store._id.toString()) {
        return res.status(400).json({ 
          message: 'Cannot add products from different stores. Clear cart first.' 
        });
      }

      const existingItemIndex = cart.items.findIndex(
        item => item.product.toString() === productId
      );

      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity });
      }

      // Set store if not set
      if (!cart.store) {
        cart.store = product.store._id;
      }

      await cart.save();
    }

    await cart.populate('items.product');
    await cart.populate('store');

    res.json(cart);
  } catch (error) {
    res.status(400).json({ message: 'Error adding to cart', error: error.message });
  }
};

// @desc    Update cart item quantity
// @route   PUT /api/cart/items/:productId
// @access  Private
const updateCartItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (quantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex(
      item => item.product.toString() === productId
    );

    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save();

    await cart.populate('items.product');
    await cart.populate('store');

    res.json(cart);
  } catch (error) {
    res.status(400).json({ message: 'Error updating cart', error: error.message });
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/items/:productId
// @access  Private
const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    cart.items = cart.items.filter(
      item => item.product.toString() !== productId
    );

    // If cart is empty, remove store reference
    if (cart.items.length === 0) {
      cart.store = null;
    }

    await cart.save();

    await cart.populate('items.product');
    await cart.populate('store');

    res.json(cart);
  } catch (error) {
    res.status(400).json({ message: 'Error removing from cart', error: error.message });
  }
};

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOneAndUpdate(
      { user: req.user.id },
      { $set: { items: [], store: null } },
      { new: true }
    ).populate('items.product').populate('store');

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
};