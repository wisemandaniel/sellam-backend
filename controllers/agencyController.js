const Agency = require('../models/Agency');

// @desc    Get all agencies with optional route filter
// @route   GET /api/agencies
// @access  Public
exports.getAllAgencies = async (req, res) => {
  try {
    const { departureCity, arrivalCity } = req.query;
    let filter = {};

    if (departureCity && arrivalCity) {
      // Match agencies that have at least one route matching both cities
      filter['routes'] = {
        $elemMatch: {
          departureCity: new RegExp(`^${departureCity}$`, 'i'),
          arrivalCity: new RegExp(`^${arrivalCity}$`, 'i')
        }
      };
    } else if (departureCity) {
      filter['routes.departureCity'] = new RegExp(`^${departureCity}$`, 'i');
    } else if (arrivalCity) {
      filter['routes.arrivalCity'] = new RegExp(`^${arrivalCity}$`, 'i');
    }

    const agencies = await Agency.find(filter);

    // If filtering by both cities, only return the matching route in each agency
    if (departureCity && arrivalCity) {
      const filteredAgencies = agencies.map(agency => {
        const matchingRoutes = agency.routes.filter(route =>
          route.departureCity.toLowerCase() === departureCity.toLowerCase() &&
          route.arrivalCity.toLowerCase() === arrivalCity.toLowerCase()
        );
        // Return agency with only matching routes
        return {
          ...agency.toObject(),
          routes: matchingRoutes
        };
      });
      return res.status(200).json({
        success: true,
        count: filteredAgencies.length,
        data: filteredAgencies
      });
    }

    res.status(200).json({
      success: true,
      count: agencies.length,
      data: agencies
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Get single agency by ID (returns all routes)
// @route   GET /api/agencies/:id
// @access  Public
exports.getAgencyById = async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'Agency not found'
      });
    }
    res.status(200).json({
      success: true,
      data: agency
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Create a new agency
// @route   POST /api/agencies
// @access  Private/Admin
exports.createAgency = async (req, res) => {
  try {
    const agency = await Agency.create(req.body);
    res.status(201).json({
      success: true,
      data: agency
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        error: messages
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Update an agency
// @route   PUT /api/agencies/:id
// @access  Private/Admin
exports.updateAgency = async (req, res) => {
  try {
    const agency = await Agency.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'Agency not found'
      });
    }
    res.status(200).json({
      success: true,
      data: agency
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        error: messages
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Delete an agency
// @route   DELETE /api/agencies/:id
// @access  Private/Admin
exports.deleteAgency = async (req, res) => {
  try {
    const agency = await Agency.findByIdAndDelete(req.params.id);
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'Agency not found'
      });
    }
    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Get all unique route pairs across all agencies
// @route   GET /api/agencies/routes
// @access  Public
exports.getRoutes = async (req, res) => {
  try {
    const routes = await Agency.aggregate([
      { $unwind: '$routes' },
      {
        $group: {
          _id: {
            departureCity: '$routes.departureCity',
            arrivalCity: '$routes.arrivalCity'
          }
        }
      },
      {
        $project: {
          _id: 0,
          departureCity: '$_id.departureCity',
          arrivalCity: '$_id.arrivalCity'
        }
      },
      { $sort: { departureCity: 1, arrivalCity: 1 } }
    ]);
    res.status(200).json({
      success: true,
      count: routes.length,
      data: routes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};