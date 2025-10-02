const Store = require('../models/Store');
const Product = require('../models/Product');

// @desc    Get all stores
// @route   GET /api/stores
// @access  Public
const getStores = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    if (category) {
      query.category = category;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const stores = await Store.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ rating: -1, createdAt: -1 });

    const total = await Store.countDocuments(query);

    res.json({
      stores,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get single store
// @route   GET /api/stores/:id
// @access  Public
const getStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    res.json(store);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get store products
// @route   GET /api/stores/:id/products
// @access  Public
const getStoreProducts = async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    
    let query = { store: req.params.id };
    
    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('store', 'name phone')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    res.json({
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Create store
// @route   POST /api/stores
// @access  Private/Admin
const createStore = async (req, res) => {
  try {
    const store = await Store.create(req.body);
    res.status(201).json(store);
  } catch (error) {
    res.status(400).json({ message: 'Error creating store', error: error.message });
  }
};

// @desc    Update store
// @route   PUT /api/stores/:id
// @access  Private/Admin
const updateStore = async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    res.json(store);
  } catch (error) {
    res.status(400).json({ message: 'Error updating store', error: error.message });
  }
};

// @desc    Delete store
// @route   DELETE /api/stores/:id
// @access  Private/Admin
const deleteStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);

    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    await store.remove();
    res.json({ message: 'Store removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getStores,
  getStore,
  getStoreProducts,
  createStore,
  updateStore,
  deleteStore
};