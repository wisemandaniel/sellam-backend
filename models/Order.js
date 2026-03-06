const mongoose = require("mongoose");

// Sub-schemas for different order types
const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
    quantity: { type: Number, min: 1 },
    price: { type: Number, min: 0 },
  },
  { _id: false }
);

// Legacy errand item schema (still supported)
const errandItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 1, min: 1 },
    description: { type: String, default: "" },
  },
  { _id: false }
);

// ==================== New Errand Sub‑schemas ====================

const shoppingErrandSchema = new mongoose.Schema(
  {
    items: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, default: 1, min: 1 },
      },
    ],
    budget: { type: Number, min: 0 },
    instructions: { type: String, default: "" },
  },
  { _id: false }
);

const billErrandSchema = new mongoose.Schema(
  {
    billType: {
      name: { type: String, required: true },
    },
    accountNumber: { type: String, required: true },
    bankName: { type: String },
    amount: { type: Number, required: true, min: 0 },
    studentInfo: {
      fullName: { type: String },
      faculty: { type: String },
      department: { type: String },
    },
    tenantInfo: {
      fullName: { type: String },
      roomNumber: { type: String },
    },
    invoiceImageUrl: { type: String },
  },
  { _id: false }
);

const documentErrandSchema = new mongoose.Schema(
  {
    documentType: {
      id: { type: String },
      name: { type: String, required: true },
    },
    studentName: { type: String, required: true },
    matricule: { type: String, required: true },
    faculty: { type: String, required: true },
    level: { type: String, required: true },
    program: { type: String, required: true },
    studentStatus: { type: String, required: true, enum: ["Current", "Past"] },
    processingMode: { type: String, required: true, enum: ["Fast", "Super Fast"] },
    additionalNotes: { type: String, default: "" },
  },
  { _id: false }
);

const ticketDataSchema = new mongoose.Schema(
  {
    busAgency: { type: String, required: true },
    seatNumber: { type: String, required: true },
    passengerName: { type: String, required: true },
    departureTime: { type: Date, required: true },
    destination: { type: String, required: true },
    departureCity: { type: String, required: true },
    price: { type: Number, default: 0 },
    backupSeats: { type: [String], default: [] },
    travelTimeOfDay: {
      type: String,
      enum: ["morning", "afternoon", "evening", "night"],
      default: "morning",
    },
    passengerIDNumber: { type: String, default: "" },
    idPhotoFront: { type: String, default: "" },
    idPhotoBack: { type: String, default: "" },
    agencyDetails: {
      id: { type: String },
      departureTime: { type: String },
      arrivalTime: { type: String },
      busType: { type: String },
    },
    serviceFee: { type: Number, default: 1500 },
    pricePerSeat: { type: Number, default: 0 },
    seatCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const bulkDataSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["pickup", "delivery"], required: true },
    parcels: [
      {
        description: { type: String, required: true },
        pickupAddress: { type: String },
        pickupContactName: { type: String },
        pickupContactPhone: { type: String },
        deliveryAddress: { type: String },
        receiverName: { type: String },
        receiverPhone: { type: String },
      },
    ],
    scheduledDate: { type: Date, required: true },
    scheduledTime: { type: String, required: true },
    receiverName: { type: String },
    receiverPhone: { type: String },
    receiverAddress: { type: String },
    pickupContactName: { type: String },
    pickupContactPhone: { type: String },
    pickupAddress: { type: String },
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
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

// Main order schema
const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    type: {
      type: String,
      enum: ["business", "errand", "ticket", "random", "bulk"],
      default: "business",
    },

    items: [orderItemSchema],
    errandItems: [errandItemSchema], // legacy (still supported)
    bulkData: bulkDataSchema,
    ticketData: ticketDataSchema,
    deliveryData: deliveryDataSchema,

    // ==================== New Errand Fields ====================
    errandType: {
      type: String,
      enum: ["shopping", "bill", "document"],
      required: function () {
        return this.type === "errand" && !this.errandItems?.length;
      },
    },
    shoppingErrand: shoppingErrandSchema,
    billErrand: billErrandSchema,
    documentErrand: documentErrandSchema,
    // ===========================================================

    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

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
      enum: ["cash", "momo", "np"],
      default: "np",
    },

    deliveryAddress: { type: String, required: true },
    phone: { type: String, required: true },
    notes: { type: String, default: "" },
    distance: { type: Number, default: 0 },

    confirmedAt: { type: Date },
    acceptedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    pickedUpAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isAdminCreated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Indexes
orderSchema.index({ type: 1, status: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model("Order", orderSchema);