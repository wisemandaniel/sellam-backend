const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  category: {
    type: String,
    default: 'restaurant'
  },
  logo: {
    type: String,
    default: ''
  },
  coverImage: {
    type: String,
    default: ''
  },
  rating: {
    type: Number,
    default: 0
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  deliveryTime: {
    type: String,
    default: '30-45 min'
  },
  deliveryFee: {
    type: Number,
    default: 1000,
    min: 0
  },
  minOrderAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  openingHours: {
    opening: { type: String, default: '08:00' },
    closing: { type: String, default: '22:00' }
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  location: {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 }
  },
  tags: [{
    type: String
  }],
  socialMedia: {
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// Virtual for average rating (if you want to calculate it)
businessSchema.virtual('averageRating').get(function() {
  return this.totalRatings > 0 ? (this.rating / this.totalRatings).toFixed(1) : 0;
});

module.exports = mongoose.model('Business', businessSchema);