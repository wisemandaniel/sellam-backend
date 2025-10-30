const Business = require('../models/Business');
const Product = require('../models/Product');

// @desc    Get all businesses
// @route   GET /api/businesses
// @access  Public
const getBusinesses = async (req, res) => {
  try {
    const businesses = await Business.find();
    res.json(businesses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single business
// @route   GET /api/businesses/:id
// @access  Public
const getBusiness = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }
    res.json(business);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create business
// @route   POST /api/businesses
// @access  Private
const addBusiness = async (req, res) => {
  try {
    const business = new Business(req.body);
    const savedBusiness = await business.save();
    res.status(201).json(savedBusiness);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update business
// @route   PUT /api/businesses/:id
// @access  Private
const updateBusiness = async (req, res) => {
  try {
    const business = await Business.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }
    res.json(business);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete business
// @route   DELETE /api/businesses/:id
// @access  Private
const deleteBusiness = async (req, res) => {
  try {
    const business = await Business.findByIdAndDelete(req.params.id);
    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }
    res.json({ message: 'Business deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get products by business
// @route   GET /api/businesses/:businessId/products
// @access  Public
// In businessController.js, add:
const getBusinessProducts = async (req, res) => {
  try {
    const { businessId } = req.params;
    
    if (!businessId) {
      return res.status(400).json({ message: 'Business ID is required' });
    }

    const products = await Product.find({ store: businessId })
      .populate('business', 'name phone deliveryFee deliveryTime');

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getBusinesses,
  getBusiness,
  addBusiness,
  updateBusiness,
  deleteBusiness,
  getBusinessProducts
};