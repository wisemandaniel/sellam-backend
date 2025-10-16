// const mongoose = require('mongoose');

// const orderItemSchema = new mongoose.Schema({
//   product: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Product',
//     required: true
//   },
//   store: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Store',
//     required: true
//   },
//   quantity: {
//     type: Number,
//     required: true,
//     min: 1
//   },
//   price: {
//     type: Number,
//     required: true,
//     min: 0
//   }
// });

// const orderSchema = new mongoose.Schema({
//   orderNumber: {
//     type: String,
//     unique: true,
//     required: true
//   },
//   user: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   rider: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   },
//   items: [orderItemSchema],
//   subtotal: {
//     type: Number,
//     required: true,
//     min: 0
//   },
//   deliveryFee: {
//     type: Number,
//     required: true,
//     min: 0
//   },
//   total: {
//     type: Number,
//     required: true,
//     min: 0
//   },
//   status: {
//     type: String,
//     enum: ['pending', 'accepted', 'picked_up', 'delivered', 'cancelled', 'rejected'],
//     default: 'pending'
//   },
//   deliveryAddress: {
//     type: String,
//     required: true
//   },
//   phone: {
//     type: String,
//     required: true
//   },
//   notes: {
//     type: String,
//     default: ''
//   },
//   // Timestamps for order lifecycle
//   acceptedAt: {
//     type: Date
//   },
//   rejectedBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   },
//   rejectedAt: {
//     type: Date
//   },
//   pickedUpAt: {
//     type: Date
//   },
//   deliveredAt: {
//     type: Date
//   },
//   cancelledAt: {
//     type: Date
//   }
// }, {
//   timestamps: true
// });

// // Indexes for performance
// orderSchema.index({ status: 1, createdAt: -1 });
// orderSchema.index({ rider: 1, status: 1 });
// orderSchema.index({ user: 1, createdAt: -1 });
// orderSchema.index({ orderNumber: 1 });

// module.exports = mongoose.model('Order', orderSchema);

/**
 * models/Order.js
 * Kept mostly the same but ensure fields used for earnings logic exist.
 */

const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [orderItemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "picked_up",
        "delivered",
        "cancelled",
        "rejected",
      ],
      default: "pending",
    },
    deliveryAddress: { type: String, required: true },
    phone: { type: String, required: true },
    notes: { type: String, default: "" },

    // Timestamps for order lifecycle
    acceptedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    pickedUpAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },

    // --- UPDATED: ensure distance is recorded when calculating delivery price
    distance: { type: Number, default: 0 }, // in meters or km as your business defines
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ rider: 1, status: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });

module.exports = mongoose.model("Order", orderSchema);
