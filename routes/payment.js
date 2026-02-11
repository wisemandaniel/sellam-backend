const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/auth');

// ==================== PUBLIC WEBHOOK (NO AUTH) ====================
// This endpoint must be public for Fapshi to call it
router.post('/fapshi-webhook', paymentController.fapshiWebhook);

// ==================== PROTECTED ROUTES ====================
// All routes below require authentication

// Create payment
router.post('/', authMiddleware.protect, paymentController.createPayment);

// Get transaction status
router.get('/status/:transactionId', authMiddleware.protect, paymentController.getTransactionStatus);

// Admin only - test Fapshi configuration
router.get('/admin/test-fapshi', 
    authMiddleware.protect, 
    authMiddleware.authorize('admin'), 
    paymentController.testFapshiConfig
);

module.exports = router;