// models/Account.js - Simplified version
const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  accountNumber: {
    type: String,
    unique: true,
    default: function() {
      return `ACC${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    }
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'inactive'],
    default: 'inactive'
  },
  tier: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: 'bronze'
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  availableBalance: {
    type: Number,
    default: 0
  },
  totalDeliveries: {
    type: Number,
    default: 0
  },
  completedDeliveries: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    default: 4.5
  },
  vehicleType: {
    type: String,
    enum: ['motorcycle', 'car'],
    default: 'motorcycle'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Account', accountSchema);