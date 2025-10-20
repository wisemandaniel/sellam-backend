const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 0,
    max: 5,
    default: 0
  },
  reviewCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  deliveryTime: {
    type: String,
    required: true
  },
  deliveryFee: {
    type: Number,
    required: true,
    min: 0
  },
  minOrder: {
    type: Number,
    required: true,
    min: 0
  },
  isOpen: {
    type: Boolean,
    required: true,
    default: true
  },
  phone: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Index for better query performance
storeSchema.index({ category: 1, isOpen: 1 });
storeSchema.index({ rating: -1 });
storeSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Store', storeSchema);