const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a store name'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Please add a description']
  },
  image: {
    type: String,
    required: [true, 'Please add an image']
  },
  category: {
    type: String,
    required: [true, 'Please add a category'],
    enum: ['Restaurants', 'Groceries', 'Electronics', 'Fashion', 'Pharmacy', 'Bakery', 'Flowers', 'Pets']
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  deliveryTime: {
    type: String,
    required: [true, 'Please add delivery time']
  },
  deliveryFee: {
    type: Number,
    required: [true, 'Please add delivery fee'],
    min: 0
  },
  minOrder: {
    type: Number,
    required: [true, 'Please add minimum order amount'],
    min: 0
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number']
  },
  address: {
    type: String,
    required: [true, 'Please add an address']
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  }
}, {
  timestamps: true
});

storeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Store', storeSchema);