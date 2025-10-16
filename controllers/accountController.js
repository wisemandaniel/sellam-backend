// // controllers/accountController.js
// const Account = require('../models/Account');
// const User = require('../models/User');
// const Order = require('../models/Order');

// // @desc    Get rider account statistics
// // @route   GET /api/accounts/statistics
// // @access  Private (Rider only)
// const getAccountStatistics = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     // Check if user is a rider
//     const user = await User.findById(userId);
//     if (!user || user.role !== 'rider') {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Rider account required.'
//       });
//     }

//     // Find or create account
//     let account = await Account.findOne({ user: userId })
//       .populate('user', 'name phone vehicleType licensePlate');

//     if (!account) {
//       account = await Account.create({
//         user: userId,
//         vehicleType: user.vehicleType
//       });
//     }

//     const performanceSummary = account.getPerformanceSummary();
//     const earningsSummary = account.getEarningsSummary();

//     // Get recent period stats
//     const recentStats = await getRecentPeriodStats(account._id);

//     res.json({
//       success: true,
//       data: {
//         account: {
//           accountNumber: account.accountNumber,
//           tier: account.tier,
//           status: account.status,
//           joinedDate: account.joinedDate,
//           lastActivity: account.lastActivity
//         },
//         user: {
//           name: user.name,
//           phone: user.phone,
//           vehicleType: user.vehicleType,
//           licensePlate: user.licensePlate
//         },
//         performance: performanceSummary,
//         earnings: earningsSummary,
//         recentStats,
//         metrics: account.metrics
//       }
//     });

//   } catch (error) {
//     console.error('❌ GET ACCOUNT STATISTICS - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // @desc    Get detailed earnings report
// // @route   GET /api/accounts/earnings
// // @access  Private (Rider only)
// const getEarningsReport = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { period = 'monthly' } = req.query;

//     const account = await Account.findOne({ user: userId });
//     if (!account) {
//       return res.status(404).json({
//         success: false,
//         message: 'Account not found'
//       });
//     }

//     const earningsData = await calculateEarningsBreakdown(userId, period);

//     res.json({
//       success: true,
//       data: {
//         summary: account.getEarningsSummary(),
//         breakdown: earningsData
//       }
//     });

//   } catch (error) {
//     console.error('❌ GET EARNINGS REPORT - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // @desc    Get performance analytics
// // @route   GET /api/accounts/analytics
// // @access  Private (Rider only)
// const getPerformanceAnalytics = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { timeframe = '30d' } = req.query;

//     const account = await Account.findOne({ user: userId });
//     if (!account) {
//       return res.status(404).json({
//         success: false,
//         message: 'Account not found'
//       });
//     }

//     const analytics = await calculatePerformanceAnalytics(userId, timeframe);

//     res.json({
//       success: true,
//       data: {
//         performance: account.getPerformanceSummary(),
//         analytics: analytics
//       }
//     });

//   } catch (error) {
//     console.error('❌ GET PERFORMANCE ANALYTICS - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // @desc    Update account with order completion
// // @route   POST /api/accounts/update-order
// // @access  Private (System use)
// const updateAccountWithOrder = async (req, res) => {
//   try {
//     const { userId, order } = req.body;

//     let account = await Account.findOne({ user: userId });
//     if (!account) {
//       account = await Account.create({ user: userId });
//     }

//     // Update performance and earnings
//     account.updatePerformance(order);
//     account.updateEarnings(order);
//     account.calculateTier();
//     account.lastActivity = new Date();

//     await account.save();

//     res.json({
//       success: true,
//       message: 'Account updated successfully'
//     });

//   } catch (error) {
//     console.error('❌ UPDATE ACCOUNT WITH ORDER - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // @desc    Get rider leaderboard
// // @route   GET /api/accounts/leaderboard
// // @access  Private (Rider only)
// const getLeaderboard = async (req, res) => {
//   try {
//     const { metric = 'completionRate', limit = 10 } = req.query;

//     const leaderboard = await Account.find({ status: 'active' })
//       .populate('user', 'name vehicleType')
//       .sort({ [`performance.${metric}`]: -1 })
//       .limit(parseInt(limit))
//       .select('user performance tier');

//     res.json({
//       success: true,
//       data: leaderboard.map((account, index) => ({
//         rank: index + 1,
//         name: account.user.name,
//         vehicleType: account.user.vehicleType,
//         metric: account.performance[metric],
//         tier: account.tier
//       }))
//     });

//   } catch (error) {
//     console.error('❌ GET LEADERBOARD - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // Helper functions
// const getRecentPeriodStats = async (accountId) => {
//   const periods = ['daily', 'weekly', 'monthly'];
//   const stats = {};

//   for (const period of periods) {
//     const orders = await getOrdersForPeriod(accountId, period);
//     stats[period] = {
//       deliveries: orders.length,
//       earnings: orders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0),
//       distance: orders.reduce((sum, order) => sum + (order.distance || 0), 0)
//     };
//   }

//   return stats;
// };

// const getOrdersForPeriod = async (accountId, period) => {
//   const account = await Account.findById(accountId);
//   if (!account) return [];

//   let startDate;
//   const now = new Date();

//   switch (period) {
//     case 'daily':
//       startDate = new Date(now.setHours(0, 0, 0, 0));
//       break;
//     case 'weekly':
//       startDate = new Date(now.setDate(now.getDate() - 7));
//       break;
//     case 'monthly':
//       startDate = new Date(now.getFullYear(), now.getMonth(), 1);
//       break;
//     default:
//       startDate = new Date(now.getFullYear(), now.getMonth(), 1);
//   }

//   return await Order.find({
//     'rider.riderId': account.user,
//     status: 'completed',
//     completedAt: { $gte: startDate }
//   });
// };

// const calculateEarningsBreakdown = async (userId, period) => {
//   const orders = await getOrdersForPeriodByUserId(userId, period);

//   return {
//     period,
//     totalEarnings: orders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0),
//     deliveryCount: orders.length,
//     averageEarningPerDelivery: orders.length > 0
//       ? orders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0) / orders.length
//       : 0,
//     orders: orders.map(order => ({
//       orderNumber: order.orderNumber,
//       earnings: order.deliveryFee,
//       date: order.completedAt,
//       distance: order.distance
//     }))
//   };
// };

// const getOrdersForPeriodByUserId = async (userId, period) => {
//   let startDate;
//   const now = new Date();

//   switch (period) {
//     case 'daily':
//       startDate = new Date(now.setHours(0, 0, 0, 0));
//       break;
//     case 'weekly':
//       startDate = new Date(now.setDate(now.getDate() - 7));
//       break;
//     case 'monthly':
//       startDate = new Date(now.getFullYear(), now.getMonth(), 1);
//       break;
//     default:
//       startDate = new Date(now.getFullYear(), now.getMonth(), 1);
//   }

//   return await Order.find({
//     'rider.riderId': userId,
//     status: 'completed',
//     completedAt: { $gte: startDate }
//   });
// };

// const calculatePerformanceAnalytics = async (userId, timeframe) => {
//   let days;
//   switch (timeframe) {
//     case '7d': days = 7; break;
//     case '30d': days = 30; break;
//     case '90d': days = 90; break;
//     default: days = 30;
//   }

//   const startDate = new Date();
//   startDate.setDate(startDate.getDate() - days);

//   const orders = await Order.find({
//     'rider.riderId': userId,
//     completedAt: { $gte: startDate }
//   });

//   const completedOrders = orders.filter(order => order.status === 'completed');

//   return {
//     timeframe,
//     totalOrders: orders.length,
//     completedOrders: completedOrders.length,
//     completionRate: orders.length > 0 ? (completedOrders.length / orders.length) * 100 : 0,
//     totalEarnings: completedOrders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0),
//     averageDeliveryTime: completedOrders.length > 0
//       ? completedOrders.reduce((sum, order) => sum + (order.deliveryTime || 0), 0) / completedOrders.length
//       : 0
//   };
// };

// module.exports = {
//   getAccountStatistics,
//   getEarningsReport,
//   getPerformanceAnalytics,
//   updateAccountWithOrder,
//   getLeaderboard
// };

/**
 * controllers/accountController.js
 * Updated + route-complete.
 */

const Account = require("../models/Account");
const User = require("../models/User");

// [PRESERVED ORIGINAL]
const getAccountStatistics = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "rider")
      return res
        .status(403)
        .json({ success: false, message: "Rider only access" });

    let account = await Account.findOne({ user: req.user.id }).populate(
      "user",
      "name phone vehicleType licensePlate"
    );
    if (!account)
      account = await Account.create({
        user: req.user.id,
        vehicleType: user.vehicleType,
        status: "active",
      });

    res.json({
      success: true,
      data: {
        performance: account.getPerformanceSummary(),
        earnings: account.getEarningsSummary(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PRESERVED ORIGINAL]
const getEarningsReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = "monthly" } = req.query;
    const account = await Account.findOne({ user: userId });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    const now = new Date();
    let startDate;
    if (period === "daily") startDate = new Date(now.setHours(0, 0, 0, 0));
    else if (period === "weekly")
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else startDate = new Date(now.getFullYear(), now.getMonth(), 1);

    const deliveries = account.totalDeliveries.deliveries || [];
    const filtered = deliveries.filter(
      (d) => new Date(d.deliveredAt) >= startDate
    );

    const totalEarnings = filtered.reduce((s, d) => s + (d.earnings || 0), 0);
    const average = filtered.length > 0 ? totalEarnings / filtered.length : 0;

    res.json({
      success: true,
      data: { period, totalEarnings, average, deliveries: filtered },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [UPDATED LOGIC]
const updateAccountWithOrder = async (req, res) => {
  try {
    const { userId, order } = req.body;
    if (!userId || !order || !order._id)
      return res
        .status(400)
        .json({ success: false, message: "userId and order required" });

    let account = await Account.findOne({ user: userId });
    if (!account)
      account = await Account.create({ user: userId, status: "active" });

    if (order.status === "accepted") account.incrementAccepted();
    if (order.status === "delivered") {
      account.updatePerformance(order);
      account.updateEarnings(order);
      account.incrementCompleted();
    }

    await account.calculateRanking();
    await account.save();

    res.json({ success: true, account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PATCHED]
const getPerformanceAnalytics = async (req, res) => {
  try {
    const account = await Account.findOne({ user: req.user.id });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    res.json({
      success: true,
      data: {
        performance: account.getPerformanceSummary(),
        earnings: account.getEarningsSummary(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PRESERVED ORIGINAL]
const getLeaderboard = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const accounts = await Account.find({ status: "active" })
      .populate("user", "name vehicleType")
      .sort({ ranking: -1 })
      .limit(Number(limit));

    res.json({
      success: true,
      data: accounts.map((a, i) => ({
        rank: i + 1,
        name: a.user?.name || "Unknown",
        completedDeliveries: a.completedDeliveries,
        successRate: a.getSuccessRate(),
        tier: a.tier,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAccountStatistics,
  getEarningsReport,
  updateAccountWithOrder,
  getPerformanceAnalytics,
  getLeaderboard,
};
