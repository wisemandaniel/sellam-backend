const User = require('../models/User');

// @desc    Get all riders
// @route   GET /api/riders
// @access  Public
const getRiders = async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider' })
      .select('-verifiedDevices -pendingDeviceVerification');
    res.json(riders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create rider
// @route   POST /api/riders
// @access  Private
const addRider = async (req, res) => {
  try {
    const riderData = {
      ...req.body,
      role: 'rider'
    };
    const rider = new User(riderData);
    const savedRider = await rider.save();
    res.status(201).json(savedRider);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update rider
// @route   PUT /api/riders/:id
// @access  Private
const updateRider = async (req, res) => {
  try {
    const rider = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'rider' },
      req.body,
      { new: true, runValidators: true }
    );
    if (!rider) {
      return res.status(404).json({ message: 'Rider not found' });
    }
    res.json(rider);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete rider
// @route   DELETE /api/riders/:id
// @access  Private
const deleteRider = async (req, res) => {
  try {
    const rider = await User.findOneAndDelete({ 
      _id: req.params.id, 
      role: 'rider' 
    });
    if (!rider) {
      return res.status(404).json({ message: 'Rider not found' });
    }
    res.json({ message: 'Rider deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getRiders,
  addRider,
  updateRider,
  deleteRider
};