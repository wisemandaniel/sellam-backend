const User = require('../models/User');

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, email, phone, address },
      { new: true, runValidators: true }
    );

    res.json(user);
  } catch (error) {
    res.status(400).json({ message: 'Error updating profile', error: error.message });
  }
};

// @desc    Create or update user
// @route   POST /api/users
// @access  Public
const createUser = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;

    // Check if user exists
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user
      user = await User.findByIdAndUpdate(
        user._id,
        { name, phone, address },
        { new: true, runValidators: true }
      );
    } else {
      // Create new user
      user = await User.create({
        name,
        email,
        phone,
        address
      });
    }

    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: 'Error creating user', error: error.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  createUser
};