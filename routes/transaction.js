const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware.protect, authMiddleware.authorize('admin'), transactionController.getTransactions);
router.get('/user', authMiddleware.protect, transactionController.getUserTransactions);
router.get('/:id', authMiddleware.protect, transactionController.getTransactionById);
router.delete('/:id', authMiddleware.protect, authMiddleware.authorize('admin'), transactionController.deleteTransaction);

module.exports = router;