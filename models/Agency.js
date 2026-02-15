const mongoose = require('mongoose');

const departureTimeSchema = new mongoose.Schema({
  session: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night'],
    required: true
  },
  time: {
    type: String,
    required: true,
    trim: true   // e.g., "8:00 AM"
  }
});

const routeSchema = new mongoose.Schema({
  departureCity: {
    type: String,
    required: true,
    trim: true
  },
  arrivalCity: {
    type: String,
    required: true,
    trim: true
  },
  pricePerSeat: {
    type: Number,
    required: true,
    min: 0
  },
  availableSeats: {
    type: Number,
    required: true,
    min: 0
  },
  departureTimes: [departureTimeSchema] // array of session-time pairs
});

const agencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Agency name is required'],
    trim: true
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  busType: {
    type: String,
    required: true,
    enum: ['AC Sleeper', 'VIP Coach', 'AC Seater', 'Semi-Sleeper', 'Volvo Multi-Axle']
  },
  totalSeats: {
    type: Number,
    required: true,
    min: 1
  },
  amenities: [{
    type: String,
    trim: true
  }],
  cancellationPolicy: {
    type: String,
    required: true
  },
  seatLayout: {
    type: String,
    enum: ['2x2', '2x3'],
    default: '2x3'
  },
  deckType: {
    type: String,
    enum: ['single', 'double'],
    default: 'single'
  },
  serviceFee: {
    type: Number,
    required: true,
    default: 1500
  },
  routes: [routeSchema],   // array of routes offered by this agency

  // Optional fields
  images: [String],
  contactPhone: String,
  contactEmail: String
}, {
  timestamps: true
});

// Create compound index for fast route queries (across all agencies)
agencySchema.index({ 'routes.departureCity': 1, 'routes.arrivalCity': 1 });

module.exports = mongoose.model('Agency', agencySchema);