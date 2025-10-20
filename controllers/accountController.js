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
