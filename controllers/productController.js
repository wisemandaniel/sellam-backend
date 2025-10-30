const Product = require('../models/Product');
const Store = require('../models/Store');

// @desc    Get all products (for frontend)
// @route   GET /api/products
// @access  Public
const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate('store', 'name phone deliveryFee deliveryTime');
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get products by business (for frontend)
// @route   GET /api/businesses/:businessId/products
// @access  Public
const getProductsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    
    if (!businessId) {
      return res.status(400).json({ message: 'Business ID is required' });
    }

    const products = await Product.find({ store: businessId })
      .populate('store', 'name phone deliveryFee deliveryTime');

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('store');
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Create product (for frontend - matches addProduct)
// @route   POST /api/products
// @access  Private
const addProduct = async (req, res) => {
  try {
    // Validate required fields
    const { name, description, price, image, category, store } = req.body;
    
    if (!name || !price || !store) {
      return res.status(400).json({ 
        message: 'Please provide all required fields: name, price, store' 
      });
    }

    // Verify store exists
    const storeExists = await Store.findById(store);
    if (!storeExists) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const product = await Product.create({
      name,
      description: description || '',
      price,
      image: image || '',
      category: category || 'food',
      store
    });
    
    await product.populate('store');
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ message: 'Error creating product', error: error.message });
  }
};

// @desc    Update product (for frontend - matches updateProduct)
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('store');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(400).json({ message: 'Error updating product', error: error.message });
  }
};

// @desc    Delete product (for frontend - matches deleteProduct)
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get products by vendor (store owner) - keep for existing functionality
// @route   GET /api/products/vendor/:storeId
// @access  Private
const getVendorProducts = async (req, res) => {
  try {
    const { category, page = 1, limit = 100 } = req.query;
    const { storeId } = req.params;
    
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' });
    }
    
    let query = { store: storeId };
    
    if (category && category !== 'all') {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('store', 'name phone deliveryFee deliveryTime')
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

// Keep original getProducts for existing mobile app functionality
const getProducts = async (req, res) => {
  try {
    const { search, category, store, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category && category !== 'all') {
      query.category = category;
    }
    
    if (store) {
      query.store = store;
    }

    const products = await Product.find(query)
      .populate('store', 'name phone deliveryFee deliveryTime')
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

module.exports = {
  // Frontend-compatible functions
  getAllProducts,
  getProductsByBusiness,
  addProduct,
  updateProduct,
  deleteProduct,
  
  // Original functions for mobile app
  getProducts,
  getProduct,
  getVendorProducts,
  createProduct: addProduct // alias for existing routes
};