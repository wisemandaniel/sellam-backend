// // models/Account.js - Simplified version
// const mongoose = require('mongoose');

// const accountSchema = new mongoose.Schema({
//   user: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true,
//     unique: true
//   },
//   accountNumber: {
//     type: String,
//     unique: true,
//     default: function() {
//       return `ACC${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
//     }
//   },
//   status: {
//     type: String,
//     enum: ['active', 'suspended', 'inactive'],
//     default: 'inactive'
//   },
//   tier: {
//     type: String,
//     enum: ['bronze', 'silver', 'gold', 'platinum'],
//     default: 'bronze'
//   },
//   totalEarnings: {
//     type: Number,
//     default: 0
//   },
//   availableBalance: {
//     type: Number,
//     default: 0
//   },
//   totalDeliveries: {
//     type: Number,
//     default: 0
//   },
//   completedDeliveries: {
//     type: Number,
//     default: 0
//   },
//   averageRating: {
//     type: Number,
//     default: 4.5
//   },
//   vehicleType: {
//     type: String,
//     enum: ['motorcycle', 'car'],
//     default: 'motorcycle'
//   }
// }, {
//   timestamps: true
// });

// module.exports = mongoose.model('Account', accountSchema);

/**
 * models/Account.js
 * Updated account model with performance/earnings methods and ranking.
 */

const mongoose = require("mongoose");

const deliveryMetaSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderNumber: String,
    deliveredAt: Date,
    deliveryFee: Number,
    distance: Number,
    earnings: Number, // driver's share
  },
  { _id: false }
);

const accountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    accountNumber: {
      type: String,
      unique: true,
      default: function () {
        return `ACC${Date.now()}${Math.random()
          .toString(36)
          .substr(2, 6)
          .toUpperCase()}`;
      },
    },
    status: {
      type: String,
      enum: ["active", "suspended", "inactive"],
      default: "inactive",
    },
    tier: {
      type: String,
      enum: ["bronze", "silver", "gold", "platinum"],
      default: "bronze",
    },

    // --- UPDATED: totalEarnings, availableBalance stored here
    totalEarnings: { type: Number, default: 0 }, // all-time earnings (driver's share)
    availableBalance: { type: Number, default: 0 }, // balance available for withdrawal

    // --- UPDATED: totalDeliveries as JSON with count + deliveries array
    totalDeliveries: {
      type: {
        count: { type: Number, default: 0 },
        deliveries: { type: [deliveryMetaSchema], default: [] },
      },
      default: { count: 0, deliveries: [] },
    },

    acceptedDeliveries: { type: Number, default: 0 }, // number of deliveries accepted
    completedDeliveries: { type: Number, default: 0 }, // number of deliveries completed

    // --- UPDATED: ranking (number) - computed by completedDeliveries then verifiedAt tie-breaker
    ranking: { type: Number, default: 0 },

    averageRating: { type: Number, default: 4.5 },

    vehicleType: {
      type: String,
      enum: ["motorcycle", "car"],
      default: "motorcycle",
    },

    // Optional metrics / stats snapshot
    metrics: { type: Object, default: {} },
  },
  {
    timestamps: true,
  }
);

// --- UPDATED: add instance method to add a delivery and update earnings/performance
/**
 * order object should contain:
 * - _id
 * - orderNumber
 * - deliveryFee
 * - distance
 * - status
 * - deliveredAt
 */
accountSchema.methods.updatePerformance = function (order) {
  // track accepted/completed counters elsewhere (controller should call increments as needed)
  if (!this.totalDeliveries) {
    this.totalDeliveries = { count: 0, deliveries: [] };
  }

  const deliveryMeta = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    deliveredAt: order.deliveredAt || new Date(),
    deliveryFee: order.deliveryFee || 0,
    distance: order.distance || 0,
    earnings: 0, // earnings should be set in updateEarnings
  };

  // Insert at start for easy recent period calculations on frontend
  this.totalDeliveries.deliveries.unshift(deliveryMeta);
  this.totalDeliveries.count = (this.totalDeliveries.count || 0) + 1;

  // Ensure storage cap
  const MAX_DELIVERIES_STORED =
    Number(process.env.MAX_DELIVERIES_STORED) || 1000;
  if (this.totalDeliveries.deliveries.length > MAX_DELIVERIES_STORED) {
    this.totalDeliveries.deliveries = this.totalDeliveries.deliveries.slice(
      0,
      MAX_DELIVERIES_STORED
    );
  }
};

accountSchema.methods.updateEarnings = function (order) {
  const DRIVER_COMMISSION_RATE =
    Number(process.env.DRIVER_COMMISSION_RATE) || 0.75; // default 75%
  const deliveryFee = Number(order.deliveryFee || 0);
  const driverShare =
    Math.round(deliveryFee * DRIVER_COMMISSION_RATE * 100) / 100; // cents-safe rounding

  // Update totals
  this.totalEarnings = (this.totalEarnings || 0) + driverShare;
  this.availableBalance = (this.availableBalance || 0) + driverShare;

  // Set earnings in most recent delivery meta if exists
  if (
    this.totalDeliveries &&
    this.totalDeliveries.deliveries &&
    this.totalDeliveries.deliveries.length > 0
  ) {
    // Find matching orderId and set earnings
    const idx = this.totalDeliveries.deliveries.findIndex(
      (d) =>
        d.orderId &&
        d.orderId.toString() === (order._id ? order._id.toString() : "")
    );
    if (idx !== -1) {
      this.totalDeliveries.deliveries[idx].earnings = driverShare;
    } else {
      // If not found (maybe updateEarnings called first), push a meta with earnings
      this.totalDeliveries.deliveries.unshift({
        orderId: order._id,
        orderNumber: order.orderNumber,
        deliveredAt: order.deliveredAt || new Date(),
        deliveryFee,
        distance: order.distance || 0,
        earnings: driverShare,
      });
      this.totalDeliveries.count = (this.totalDeliveries.count || 0) + 1;
    }
  }
};

accountSchema.methods.incrementAccepted = function () {
  this.acceptedDeliveries = (this.acceptedDeliveries || 0) + 1;
};

accountSchema.methods.incrementCompleted = function () {
  this.completedDeliveries = (this.completedDeliveries || 0) + 1;
};

// --- UPDATED: compute successRate safely
accountSchema.methods.getSuccessRate = function () {
  const accepted = this.acceptedDeliveries || 0;
  const completed = this.completedDeliveries || 0;
  if (accepted === 0) return 0;
  return (completed / accepted) * 100;
};

accountSchema.methods.getPerformanceSummary = function () {
  return {
    acceptedDeliveries: this.acceptedDeliveries || 0,
    completedDeliveries: this.completedDeliveries || 0,
    totalDeliveriesCount:
      (this.totalDeliveries && this.totalDeliveries.count) || 0,
    successRate:
      Math.round((this.getSuccessRate() + Number.EPSILON) * 100) / 100, // 2 decimals
  };
};

accountSchema.methods.getEarningsSummary = function () {
  return {
    totalEarnings: this.totalEarnings || 0,
    availableBalance: this.availableBalance || 0,
    averageEarningPerDelivery:
      this.completedDeliveries && this.completedDeliveries > 0
        ? this.totalEarnings / this.completedDeliveries
        : 0,
  };
};

// --- UPDATED: ranking calculation uses completedDeliveries then user's phone verified time to break ties
accountSchema.methods.calculateRanking = async function () {
  try {
    // We'll compute a ranking metric: primary = completedDeliveries, secondary = verifiedAt (earlier verified => higher priority)
    const completed = this.completedDeliveries || 0;

    // Fetch user's verifiedAt (we assume first verified device verifiedAt or user.updatedAt when phoneVerified set)
    const User = mongoose.model("User");
    const user = await User.findById(this.user).select(
      "verifiedDevices phoneVerified createdAt updatedAt"
    );
    let verifiedAt = null;
    if (user) {
      if (user.verifiedDevices && user.verifiedDevices.length > 0) {
        // Choose earliest verifiedAt
        verifiedAt = user.verifiedDevices
          .filter((d) => d && d.verifiedAt)
          .map((d) => new Date(d.verifiedAt))
          .sort((a, b) => a - b)[0];
      }
      if (!verifiedAt && user.phoneVerified) {
        // fallback to updatedAt
        verifiedAt = user.updatedAt || user.createdAt;
      }
    }

    // We set a simple ranking value: completed * 1e12 - timestamp (so more completions > earlier verified)
    const ts = verifiedAt ? new Date(verifiedAt).getTime() : Date.now();
    const rankValue = completed * 1e12 - ts;
    this.ranking = Math.round(rankValue);
    return this.ranking;
  } catch (err) {
    // silently ignore ranking calc errors
    return this.ranking || 0;
  }
};

module.exports = mongoose.model("Account", accountSchema);
