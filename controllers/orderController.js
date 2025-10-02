const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Store = require('../models/Store');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
  try {
    const { items, storeId, deliveryAddress, phone, notes } = req.body;
    const userId = req.user.id;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items in order' });
    }

    // Get store details
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Calculate totals and validate products
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.product} not found` });
      }

      if (!product.inStock) {
        return res.status(400).json({ message: `Product ${product.name} is out of stock` });
      }

      const price = product.discount > 0 
        ? product.price * (1 - product.discount / 100)
        : product.price;

      const itemTotal = price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: price
      });
    }

    const total = subtotal + store.deliveryFee;

    // Create order
    const order = await Order.create({
      user: userId,
      store: storeId,
      items: orderItems,
      subtotal,
      deliveryFee: store.deliveryFee,
      total,
      deliveryAddress,
      phone,
      notes
    });

    await order.populate('store user items.product');

    // Clear user's cart
    await Cart.findOneAndUpdate(
      { user: userId },
      { $set: { items: [], store: null } }
    );

    // Generate WhatsApp message
    const itemsList = order.items.map(item => 
      `${item.quantity}x ${item.product.name} - XAF ${(item.price * item.quantity).toFixed(0)}`
    ).join('\n');

    const whatsappMessage = `New Order #${order.orderNumber}

Store: ${store.name}
Customer: ${order.user.name}
Phone: ${order.phone}

Items:
${itemsList}

Subtotal: XAF ${subtotal.toFixed(0)}
Delivery Fee: XAF ${store.deliveryFee.toFixed(0)}
Total: XAF ${total.toFixed(0)}

Delivery Address: ${deliveryAddress}
Notes: ${notes || 'None'}

Status: ${order.status}`;

    const whatsappUrl = `https://wa.me/${store.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(whatsappMessage)}`;

    res.status(201).json({
      order,
      whatsappUrl,
      message: 'Order created successfully'
    });

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get user orders
// @route   GET /api/orders/my-orders
// @access  Private
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate('store', 'name phone')
      .populate('items.product', 'name image')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('store')
      .populate('user')
      .populate('items.product');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user owns the order or is admin
    if (order.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('store user items.product');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    res.status(400).json({ message: 'Error updating order', error: error.message });
  }
};

// @desc    Get all orders (Admin)
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    let query = {};
    if (status) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('store', 'name')
      .populate('user', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments(query);

    res.json({
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  updateOrderStatus,
  getOrders
};