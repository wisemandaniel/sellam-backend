const mongoose = require("mongoose");

// Sub-schemas for different order types
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
    },
    quantity: { type: Number, min: 1 },
    price: { type: Number, min: 0 },
  },
  { _id: false }
);

const errandItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 1, min: 1 },
    description: { type: String, default: "" }
  },
  { _id: false }
);

const ticketDataSchema = new mongoose.Schema(
  {
    busAgency: { type: String, required: true },
    seatNumber: { type: String, required: true },
    idCard: { type: String, required: true },
    departureTime: { type: Date, required: true },
    destination: { type: String, required: true },
    price: { type: Number, default: 0 }
  },
  { _id: false }
);

const deliveryDataSchema = new mongoose.Schema(
  {
    pickupAddress: { type: String, required: true },
    deliveryAddress: { type: String, required: true },
    senderNumber: { type: String, required: true },
    receiverNumber: { type: String, required: true },
    itemDescription: { type: String, required: true },
    price: { type: Number, default: 0 }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    
    // Order type and items
    type: {
      type: String,
      enum: ["business", "errand", "ticket", "random"],
      default: "business"
    },
    
    // Business order items (products from stores)
    items: [orderItemSchema],
    
    // Errand items (user-defined shopping list)
    errandItems: [errandItemSchema],
    
    // Ticket booking data
    ticketData: ticketDataSchema,
    
    // Random delivery data
    deliveryData: deliveryDataSchema,
    
    // Financials
    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    
    // Status and payment
    status: {
      type: String,
      enum: ["pending", "confirmed", "accepted", "picked_up", "delivered", "cancelled", "rejected"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "momo", 'np'],
      default: "np",
    },
    
    // Delivery information
    deliveryAddress: { type: String, required: true },
    phone: { type: String, required: true },
    notes: { type: String, default: "" },
    distance: { type: Number, default: 0 },

    // Timestamps
    acceptedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    pickedUpAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },

    // Admin creation tracking
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isAdminCreated: { type: Boolean, default: false }
  },
  {
    timestamps: true,
  }
);

// Indexes
orderSchema.index({ type: 1, status: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model("Order", orderSchema);