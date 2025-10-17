// // models/User.js
// const mongoose = require("mongoose");
// const jwt = require("jsonwebtoken");

// const deviceSchema = new mongoose.Schema({
//   deviceId: {
//     type: String,
//     required: true,
//   },
//   deviceType: {
//     type: String,
//     default: "mobile",
//   },
//   os: {
//     type: String,
//     default: "unknown",
//   },
//   isVerified: {
//     type: Boolean,
//     default: true,
//   },
//   verifiedAt: {
//     type: Date,
//     default: Date.now,
//   },
//   lastLogin: {
//     type: Date,
//     default: Date.now,
//   },
// });

// const userSchema = new mongoose.Schema(
//   {
//     name: {
//       type: String,
//       trim: true,
//       default: "",
//     },
//     phone: {
//       type: String,
//       required: [true, "Please add a phone number"],
//       unique: true,
//       trim: true,
//     },
//     email: {
//       type: String,
//       trim: true,
//       default: "",
//       lowercase: true,
//     },
//     address: {
//       type: String,
//       default: "",
//     },
//     profileImage: {
//       type: String,
//       default: "",
//     },
//     role: {
//       type: String,
//       enum: ["client", "rider", "vendor"],
//       default: "client",
//     },
//     vehicleType: {
//       type: String,
//       enum: ["motorcycle", "car"],
//       default: "motorcycle",
//     },
//     licensePlate: {
//       type: String,
//       default: "",
//     },
//     rating: {
//       type: Number,
//       default: 4.5,
//       min: 0,
//       max: 5,
//     },
//     totalDeliveries: {
//       type: Number,
//       default: 0,
//     },
//     isProfileComplete: {
//       type: Boolean,
//       default: false,
//     },
//     isActive: {
//       type: Boolean,
//       default: false,
//     },
//     lastLogin: {
//       type: Date,
//       default: Date.now,
//     },
//     // Device management
//     verifiedDevices: [deviceSchema],
//     pendingDeviceVerification: {
//       deviceId: String,
//       deviceInfo: Object,
//       phone: String,
//       requestedAt: Date,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// // Generate JWT token
// userSchema.methods.generateAuthToken = function () {
//   const token = jwt.sign(
//     {
//       id: this._id,
//       role: this.role,
//     },
//     process.env.JWT_SECRET || "fallback-secret-key-for-development",
//     { expiresIn: "36500d" }
//   );
//   return token;
// };

// // Check if profile is complete
// userSchema.methods.checkProfileComplete = function () {
//   this.isProfileComplete = !!(this.name && this.address && this.phone);
//   return this.isProfileComplete;
// };

// // Check if device is verified
// userSchema.methods.isDeviceVerified = function (deviceId) {
//   if (!this.verifiedDevices || this.verifiedDevices.length === 0) {
//     return false;
//   }

//   return this.verifiedDevices.some(
//     (device) => device.deviceId === deviceId && device.isVerified
//   );
// };

// // Add or update verified device
// userSchema.methods.addVerifiedDevice = function (deviceId, deviceInfo = {}) {
//   if (!this.verifiedDevices) {
//     this.verifiedDevices = [];
//   }

//   const existingDeviceIndex = this.verifiedDevices.findIndex(
//     (device) => device.deviceId === deviceId
//   );

//   const deviceData = {
//     deviceId,
//     deviceType: deviceInfo.deviceType || "mobile",
//     os: deviceInfo.os || "unknown",
//     isVerified: true,
//     verifiedAt: new Date(),
//     lastLogin: new Date(),
//   };

//   if (existingDeviceIndex !== -1) {
//     this.verifiedDevices[existingDeviceIndex] = {
//       ...this.verifiedDevices[existingDeviceIndex],
//       ...deviceData,
//     };
//   } else {
//     this.verifiedDevices.push(deviceData);
//   }

//   // Limit to 5 devices
//   if (this.verifiedDevices.length > 5) {
//     this.verifiedDevices.sort(
//       (a, b) => new Date(b.lastLogin) - new Date(a.lastLogin)
//     );
//     this.verifiedDevices = this.verifiedDevices.slice(0, 5);
//   }
// };

// // Update profile complete before saving
// userSchema.pre("save", function (next) {
//   this.checkProfileComplete();
//   next();
// });

// module.exports = mongoose.model("User", userSchema);

/**
 * models/User.js
 * Complete updated file with requested schema and helpers.
 */
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    deviceType: { type: String, default: "mobile" },
    os: { type: String, default: "unknown" },
    isVerified: { type: Boolean, default: true },
    verifiedAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    phone: {
      type: String,
      required: [true, "Please add a phone number"],
      unique: true,
      trim: true,
    },
    email: { type: String, trim: true, default: "", lowercase: true },
    address: { type: String, default: "" },
    profileImage: { type: String, default: "" },
    role: {
      type: String,
      enum: ["client", "rider", "vendor"],
      default: "client",
    },
    vehicleType: {
      type: String,
      enum: ["motorcycle", "car"],
      default: "motorcycle",
    },
    licensePlate: { type: String, default: "" },
    rating: { type: Number, default: 4.5, min: 0, max: 5 },

    totalDeliveries: {
      type: {
        count: { type: Number, default: 0 },
        deliveries: { type: [Object], default: [] },
      },
      default: { count: 0, deliveries: [] },
    },

    isProfileComplete: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },

    lastLogin: { type: Date, default: Date.now },

    verifiedDevices: [deviceSchema],
    pendingDeviceVerification: {
      deviceId: String,
      deviceInfo: Object,
      phone: String,
      requestedAt: Date,
    },
  },
  { timestamps: true }
);

// Generate JWT token
userSchema.methods.generateAuthToken = function () {
  const token = jwt.sign(
    { id: this._id, role: this.role },
    process.env.JWT_SECRET || "fallback-secret-key-for-development",
    { expiresIn: "36500d" }
  );
  return token;
};

// Check if profile is complete
userSchema.methods.checkProfileComplete = function () {
  this.isProfileComplete = !!(this.name && this.address && this.phone);
  return this.isProfileComplete;
};

// Compute isActive (active only when profile complete + phone verified)
userSchema.methods.computeIsActive = function () {
  this.isActive = !!(this.isProfileComplete && this.phoneVerified);
  return this.isActive;
};

// Check if device is verified
userSchema.methods.isDeviceVerified = function (deviceId) {
  if (!this.verifiedDevices || this.verifiedDevices.length === 0) return false;
  return this.verifiedDevices.some(
    (device) => device.deviceId === deviceId && device.isVerified
  );
};

// Add or update verified device
userSchema.methods.addVerifiedDevice = function (deviceId, deviceInfo = {}) {
  if (!this.verifiedDevices) this.verifiedDevices = [];

  const existingDeviceIndex = this.verifiedDevices.findIndex(
    (device) => device.deviceId === deviceId
  );

  const deviceData = {
    deviceId,
    deviceType: deviceInfo.deviceType || "mobile",
    os: deviceInfo.os || "unknown",
    isVerified: true,
    verifiedAt: new Date(),
    lastLogin: new Date(),
    ...deviceInfo,
  };

  if (existingDeviceIndex !== -1) {
    this.verifiedDevices[existingDeviceIndex] = {
      ...this.verifiedDevices[existingDeviceIndex],
      ...deviceData,
    };
  } else {
    this.verifiedDevices.push(deviceData);
  }

  // Limit to 5 devices
  if (this.verifiedDevices.length > 5) {
    this.verifiedDevices.sort(
      (a, b) => new Date(b.lastLogin) - new Date(a.lastLogin)
    );
    this.verifiedDevices = this.verifiedDevices.slice(0, 5);
  }
};

// Push delivery metadata
userSchema.methods.pushDeliveryMeta = function (deliveryMeta) {
  if (!this.totalDeliveries) {
    this.totalDeliveries = { count: 0, deliveries: [] };
  }
  this.totalDeliveries.deliveries.unshift(deliveryMeta);
  this.totalDeliveries.count = (this.totalDeliveries.count || 0) + 1;

  const MAX_DELIVERIES_STORED =
    Number(process.env.MAX_DELIVERIES_STORED) || 1000;
  if (this.totalDeliveries.deliveries.length > MAX_DELIVERIES_STORED) {
    this.totalDeliveries.deliveries = this.totalDeliveries.deliveries.slice(
      0,
      MAX_DELIVERIES_STORED
    );
  }
};

// Pre-save hook: recompute profile completeness and activity
userSchema.pre("save", function (next) {
  this.checkProfileComplete();
  this.computeIsActive();
  next();
});

// Post-save hook: sync Account model automatically
userSchema.post("save", async function (doc) {
  try {
    const Account = require("./Account");
    const account = await Account.findOne({ user: doc._id });

    if (account) {
      // Keep account status aligned with user activity
      const desiredStatus = doc.isActive ? "active" : "inactive";
      if (account.status !== desiredStatus) {
        account.status = desiredStatus;
        await account.save();
      }
    } else if (doc.role === "rider") {
      // Create a new inactive account by default
      await Account.create({
        user: doc._id,
        vehicleType: doc.vehicleType,
        status: doc.isActive ? "active" : "inactive",
      });
    }
  } catch (err) {
    console.error("Error syncing account after user save:", err.message);
  }
});

module.exports = mongoose.model("User", userSchema);
