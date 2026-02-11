const Transaction = require('../models/transaction');
const Payment = require('../models/payment');

// Get all transactions (admin only)
exports.getTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find()
            .populate('user', 'name email phone')
            .populate('payment')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            success: true,
            count: transactions.length,
            data: transactions
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Get user's own transactions
exports.getUserTransactions = async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id || req.user.id;
        
        const transactions = await Transaction.find({ user: userId })
            .populate('payment')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            success: true,
            count: transactions.length,
            data: transactions
        });
    } catch (error) {
        console.error('Error fetching user transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Get transaction by ID
exports.getTransactionById = async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id)
            .populate('user', 'name email phone')
            .populate('payment');
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // Check authorization - only admin or the transaction owner
        const userId = req.user.userId || req.user._id || req.user.id;
        if (req.user.role !== 'admin' && transaction.user.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this transaction'
            });
        }
        
        res.status(200).json({
            success: true,
            data: transaction
        });
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Delete transaction (admin only)
exports.deleteTransaction = async (req, res) => {
    try {
        const transaction = await Transaction.findByIdAndDelete(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Transaction deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};