const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
require('dotenv').config();

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
      required: false,
      unique: true,
      trim: true,
    },
    email: { 
      type: String, 
      trim: true, 
      required: false,
      unique: true,
      lowercase: true,
      sparse: true
    },
    address: { type: String, default: "" },
    profileImage: { type: String, default: "" },
    
    // PASSWORD FIELD
    password: {
      type: String,
      required: function() {
        return ['admin', 'vendor'].includes(this.role);
      },
      minlength: 6,
      select: false
    },
    
    role: {
      type: String,
      enum: ["client", "rider", "vendor", "admin"],
      required: true,
      default: "client"
    },
    vehicleType: {
      type: String,
      enum: ["bike", "car", "bicycle", "on_foot"],
      default: "bike",
    },
    licensePlate: { type: String, default: "" },
    
    // ✅ NEW FIELD: Approval status for riders (admin approval)
    isApproved: { type: Boolean, default: false },
    
    // Rating and ranking system
    rating: { type: Number, default: 4.5, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    
    // Ranking information (computed)
    ranking: {
      rank: { type: Number, default: 0 },
      totalAgents: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now }
    },
    commission: {
      type: Number,
      default: 0.75, // 75% default commission
      min: 0,
      max: 1
    },

    totalDeliveries: {
      type: {
        count: { type: Number, default: 0 },
        deliveries: { type: [Object], default: [] },
      },
      default: { count: 0, deliveries: [] },
    },

    isProfileComplete: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
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

// ==================== MIDDLEWARE ====================

// Pre-save: hash password, compute profile completeness & active status
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }
  
  this.checkProfileComplete();
  this.computeIsActive();
  next();
});

// Pre-update middleware for findOneAndUpdate
// Ensures isProfileComplete is recalculated when relevant fields change
userSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  
  // Fields that affect profile completeness
  const relevantFields = ['name', 'address', 'phone', 'profileImage'];
  
  // Check if any relevant field is being modified
  let shouldRecalc = false;
  if (update.$set) {
    for (const field of relevantFields) {
      if (update.$set[field] !== undefined) {
        shouldRecalc = true;
        break;
      }
    }
  }
  // Also check if any relevant field is being unset (removed)
  if (update.$unset) {
    for (const field of relevantFields) {
      if (update.$unset[field] !== undefined) {
        shouldRecalc = true;
        break;
      }
    }
  }
  
  if (shouldRecalc) {
    // Fetch the document to merge with updates
    const docToUpdate = await this.model.findOne(this.getQuery()).session(this.getOptions().session);
    if (docToUpdate) {
      // Apply the updates to the document (in memory)
      if (update.$set) {
        Object.assign(docToUpdate, update.$set);
      }
      if (update.$unset) {
        for (const field of Object.keys(update.$unset)) {
          docToUpdate[field] = undefined;
        }
      }
      
      // Recompute profile completeness on the merged document
      docToUpdate.checkProfileComplete();
      
      // Add isProfileComplete to the update operation
      if (!update.$set) update.$set = {};
      update.$set.isProfileComplete = docToUpdate.isProfileComplete;
    }
  }
  
  next();
});

// Post-save: sync with Account model and trigger ranking update
userSchema.post("save", async function (doc) {
  try {
    const Account = require("./Account");
    const account = await Account.findOne({ user: doc._id });

    if (account) {
      const desiredStatus = doc.isActive ? "active" : "inactive";
      if (account.status !== desiredStatus) {
        account.status = desiredStatus;
        await account.save();
      }
    } else if (doc.role === "rider") {
      await Account.create({
        user: doc._id,
        vehicleType: doc.vehicleType,
        status: doc.isActive ? "active" : "inactive",
      });
    }

    if (doc.role === 'rider') {
      setTimeout(async () => {
        try {
          await mongoose.model('User').updateAllRankings();
        } catch (error) {
          console.error('Error updating rankings after user save:', error);
        }
      }, 1000);
    }
  } catch (err) {
    console.error("Error syncing account after user save:", err.message);
  }
});

// ==================== METHODS ====================

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    if (!this.password) {
      return false;
    }
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Error comparing passwords');
  }
};

// Generate JWT token
userSchema.methods.generateAuthToken = function () {
  const payload = {
    id: this._id,
    email: this.email,
    role: this.role,
    phone: this.phone
  };

  console.log('🔐 GENERATING TOKEN - JWT_EXPIRE:', process.env.JWT_EXPIRE);
  
  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "30d" }
  );
  
  console.log('✅ TOKEN GENERATED for user:', this.email);
  return token;
};

// Check if profile is complete (name, address, phone, profileImage)
userSchema.methods.checkProfileComplete = function () {
  this.isProfileComplete = !!(this.name && this.address && this.phone && this.profileImage);
  return this.isProfileComplete;
};

// Compute isActive (profile complete + phone verified)
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

  if (this.verifiedDevices.length > 5) {
    this.verifiedDevices.sort(
      (a, b) => new Date(b.lastLogin) - new Date(a.lastLogin)
    );
    this.verifiedDevices = this.verifiedDevices.slice(0, 5);
  }
};

// Update ranking using STATIC method for consistency
userSchema.methods.updateRanking = async function () {
  if (this.role !== 'rider') return null;

  try {
    console.log(`🔄 Updating ranking for ${this.name || this.phone}`);
    
    const result = await mongoose.model('User').updateAllRankings();
    
    if (result) {
      const updatedUser = await mongoose.model('User').findById(this._id);
      console.log(`✅ Ranking updated: ${updatedUser.ranking.rank}/${updatedUser.ranking.totalAgents}`);
      return updatedUser.ranking;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error updating ranking:', error);
    return null;
  }
};

// Get ranking as formatted string
userSchema.methods.getRankingString = function () {
  const { rank, totalAgents } = this.ranking;
  if (rank === 0 || totalAgents === 0) return 'Unranked';
  return `${rank}/${totalAgents}`;
};

// Push delivery metadata
userSchema.methods.pushDeliveryMeta = function (deliveryMeta) {
  if (!this.totalDeliveries) {
    this.totalDeliveries = { count: 0, deliveries: [] };
  }
  
  this.totalDeliveries.deliveries.unshift(deliveryMeta);
  this.totalDeliveries.count = (this.totalDeliveries.count || 0) + 1;

  const MAX_DELIVERIES_STORED = Number(process.env.MAX_DELIVERIES_STORED) || 1000;
  if (this.totalDeliveries.deliveries.length > MAX_DELIVERIES_STORED) {
    this.totalDeliveries.deliveries = this.totalDeliveries.deliveries.slice(0, MAX_DELIVERIES_STORED);
  }

  if (this.role === 'rider' && deliveryMeta.status === 'completed') {
    console.log(`📦 Delivery completed, updating ALL rankings...`);
    
    setTimeout(async () => {
      try {
        await mongoose.model('User').updateAllRankings();
      } catch (error) {
        console.error('Error updating rankings after delivery:', error);
      }
    }, 1000);
  }
};

// ==================== STATIC METHODS ====================

// Update ALL rankings at once for consistency
userSchema.statics.updateAllRankings = async function () {
  try {
    console.log('🔄 UPDATING ALL RANKINGS CONSISTENTLY...');
    
    const allRiders = await this.find({ role: 'rider' })
      .select('_id name totalDeliveries.count rating')
      .lean();

    console.log(`📈 Found ${allRiders.length} total riders`);

    const sortedRiders = allRiders.sort((a, b) => {
      const aDeliveries = a.totalDeliveries?.count || 0;
      const bDeliveries = b.totalDeliveries?.count || 0;
      
      if (bDeliveries !== aDeliveries) {
        return bDeliveries - aDeliveries;
      }
      
      return (b.rating || 0) - (a.rating || 0);
    });

    const rankingUpdates = [];
    for (let i = 0; i < sortedRiders.length; i++) {
      const rider = sortedRiders[i];
      const rank = i + 1;
      
      rankingUpdates.push({
        updateOne: {
          filter: { _id: rider._id },
          update: {
            $set: {
              'ranking.rank': rank,
              'ranking.totalAgents': sortedRiders.length,
              'ranking.lastUpdated': new Date()
            }
          }
        }
      });
    }

    if (rankingUpdates.length > 0) {
      await this.bulkWrite(rankingUpdates);
      console.log(`✅ Updated rankings for ${rankingUpdates.length} riders`);
    }

    return {
      success: true,
      totalRiders: sortedRiders.length,
      updatedCount: rankingUpdates.length
    };
  } catch (error) {
    console.error('❌ Error updating all rankings:', error);
    return { success: false, error: error.message };
  }
};

// EMERGENCY FIX: Force update ranking for all riders
userSchema.statics.fixAllRankings = async function () {
  try {
    console.log('🚨 FORCE UPDATING ALL RANKINGS CONSISTENTLY...');
    
    const result = await this.updateAllRankings();
    
    if (result.success) {
      console.log(`🎉 Successfully fixed rankings for ${result.totalRiders} riders`);
    } else {
      console.log('❌ Failed to fix rankings');
    }
    
    return result;
  } catch (error) {
    console.error('Error in fixAllRankings:', error);
    return { success: false, error: error.message };
  }
};

// ==================== EXPORT ====================
// Use safe export pattern to avoid model overwrite errors
module.exports = mongoose.models.User || mongoose.model("User", userSchema);