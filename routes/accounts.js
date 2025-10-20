// routes/accounts.js
const express = require('express');
const {
  getAccountStatistics,
  getEarningsReport,
  getPerformanceAnalytics,
  updateAccountWithOrder,
  getLeaderboard
} = require('../controllers/accountController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes are protected and rider-only
router.use(protect);
router.use(authorize('rider'));

// Rider account routes
router.get('/statistics', getAccountStatistics);
router.get('/earnings', getEarningsReport);
router.get('/analytics', getPerformanceAnalytics);
router.get('/leaderboard', getLeaderboard);

// System route (called when orders are completed) - allow multiple roles
router.post('/update-order', authorize('rider', 'admin', 'system'), updateAccountWithOrder);

module.exports = router;