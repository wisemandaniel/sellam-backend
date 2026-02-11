const Payment = require('../models/payment');
const Transaction = require('../models/transaction');
const axios = require('axios');

// ==================== CONFIGURATION & VALIDATION ====================

const verifyFapshiConfig = () => {
    const required = [
        'FAPSHI_URL',
        'FAPSHI_API_USER_COLLECTION',
        'FAPSHI_API_KEY_COLLECTION'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.warn('⚠️ Warning: Missing Fapshi environment variables:', missing.join(', '));
    } else {
        console.log(`✅ Fapshi configuration verified (${process.env.FAPSHI_MODE || 'live'} mode)`);
        console.log(`   API URL: ${process.env.FAPSHI_URL}`);
    }
};
verifyFapshiConfig();

// ==================== HELPER FUNCTIONS ====================

const getUserId = (req) => {
    if (req.user && req.user.userId) return req.user.userId;
    if (req.user && req.user._id) return req.user._id;
    if (req.user && req.user.id) return req.user.id;
    return null;
};

const normalizePhoneNumber = (phone) => {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-9);
};

const isValidCameroonPhone = (phone) => {
    const normalized = normalizePhoneNumber(phone);
    return normalized.length === 9 && /^[6][5-9][0-9]{7}$/.test(normalized);
};

// ==================== FAPSHI API FUNCTIONS ====================

const initiateFapshiPayment = async (amount, from, message) => {
    try {
        const url = `${process.env.FAPSHI_URL}/direct-pay`;
        console.log('📤 Fapshi Payment Request:', { url, amount, from, message });

        const response = await axios.post(url,
            {
                amount: Number(amount),
                phone: from,
                message: message.substring(0, 50)
            },
            {
                headers: {
                    'apiuser': process.env.FAPSHI_API_USER_COLLECTION,
                    'apikey': process.env.FAPSHI_API_KEY_COLLECTION,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('✅ Fapshi Payment Response:', {
            status: response.status,
            transId: response.data?.transId,
            data: response.data
        });

        return response;
    } catch (error) {
        console.error('❌ Fapshi Payment Error:', {
            url: `${process.env.FAPSHI_URL}/direct-pay`,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        throw error;
    }
};

const getFapshiTransactionStatus = async (trans_id) => {
    if (!trans_id) {
        console.error('❌ getFapshiTransactionStatus: No transaction ID provided');
        return null;
    }

    console.log('🔍 Checking status for transaction:', trans_id);

    try {
        const response = await axios.get(
            `${process.env.FAPSHI_URL}/payment-status/${trans_id}/`,
            {
                headers: {
                    'apiuser': process.env.FAPSHI_API_USER_COLLECTION,
                    'apikey': process.env.FAPSHI_API_KEY_COLLECTION,
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        console.log('✅ Status response for', trans_id, ':', response.data);
        return response.data;
    } catch (error) {
        console.error(`❌ Error getting status for ${trans_id}:`, 
            error.response?.data || error.message);
        
        if (error.response?.status === 404) {
            console.log(`⏳ Transaction ${trans_id} not found yet - might be processing`);
            return { status: 'PENDING' };
        }
        
        return null;
    }
};

// ==================== PAYMENT CONTROLLERS ====================

/**
 * Create a new payment – initiates transaction with Fapshi and stores PENDING status.
 */
exports.createPayment = async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    try {
        const { amount, from } = req.body;

        // Validate input
        if (!amount || !from) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        if (amount <= 0) {
            return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
        }
        if (!isValidCameroonPhone(from)) {
            return res.status(400).json({ success: false, error: 'Invalid phone number' });
        }

        const normalizedFrom = normalizePhoneNumber(from);

        // Initiate Fapshi payment
        let fapshiResponse;
        try {
            fapshiResponse = await initiateFapshiPayment(
                amount,
                normalizedFrom,
                `Payment from user ${userId}`
            );
        } catch (error) {
            if (error.response?.data?.message?.includes('amount below minimum')) {
                return res.status(400).json({
                    success: false,
                    error: 'Amount below minimum transaction limit',
                    details: error.response.data.message
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Payment initiation failed',
                details: error.response?.data || error.message
            });
        }

        if (!fapshiResponse?.data) {
            return res.status(500).json({ success: false, error: 'Invalid response from payment provider' });
        }

        const transactionId = fapshiResponse.data.transId ||
            fapshiResponse.data.transactionId ||
            fapshiResponse.data.id ||
            fapshiResponse.data.reference;

        if (!transactionId) {
            console.error('❌ No transaction ID in Fapshi response:', fapshiResponse.data);
            return res.status(500).json({ success: false, error: 'No transaction ID received' });
        }

        // Create Payment record
        const payment = new Payment({
            user: userId,
            amount,
            from: normalizedFrom,
            currency: 'XAF',
            status: 'PENDING',
            transactionId
        });

        const savedPayment = await payment.save();

        // Create Transaction record
        if (Transaction) {
            try {
                const transaction = new Transaction({
                    payment: savedPayment._id,
                    type: 'PAYMENT',
                    user: userId,
                    amount,
                    currency: 'XAF',
                    status: 'PENDING',
                    transactionId
                });
                await transaction.save();
            } catch (transError) {
                console.error('⚠️ Failed to create transaction record:', transError.message);
                // Continue – payment is already saved
            }
        }

        // Asynchronously check initial status (non-blocking)
        setImmediate(async () => {
            try {
                const statusData = await getFapshiTransactionStatus(transactionId);
                if (statusData?.status && statusData.status !== 'PENDING') {
                    savedPayment.status = statusData.status;
                    await savedPayment.save();

                    const transaction = await Transaction.findOne({ transactionId });
                    if (transaction) {
                        transaction.status = statusData.status;
                        await transaction.save();
                    }
                    console.log(`✅ Payment ${savedPayment._id} status updated to ${statusData.status}`);
                }
            } catch (err) {
                console.error('❌ Status check failed:', err.message);
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Payment initiated successfully',
            transactionId,
            paymentId: savedPayment._id,
            status: 'PENDING'
        });

    } catch (error) {
        console.error('❌ Payment creation failed:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

/**
 * Fapshi Webhook Endpoint – receives final status and updates local records.
 */
exports.fapshiWebhook = async (req, res) => {
    try {
        console.log('🔔 Fapshi Webhook Received:', { body: req.body, timestamp: new Date().toISOString() });

        const { status, transId } = req.body;
        const transactionId = transId || req.body.reference || req.body.transactionId;
        const transactionStatus = status || req.body.event;

        if (!transactionId || !transactionStatus) {
            console.error('❌ Invalid webhook payload:', req.body);
            return res.status(400).json({ error: 'Invalid payload' });
        }

        console.log(`🔄 Processing webhook for transaction: ${transactionId}, status: ${transactionStatus}`);

        // Find payment
        const payment = await Payment.findOne({ transactionId });
        if (!payment) {
            console.log(`⚠️ Payment not found for transaction: ${transactionId}`);
            return res.status(404).json({ error: 'Payment record not found' });
        }

        // Map Fapshi status to internal enum
        let newStatus;
        if (transactionStatus === 'SUCCESSFUL' || transactionStatus === 'SUCCESS') {
            newStatus = 'SUCCESSFUL';
        } else if (transactionStatus === 'FAILED') {
            newStatus = 'FAILED';
        } else if (transactionStatus === 'EXPIRED') {
            newStatus = 'EXPIRED';
        } else {
            newStatus = 'PENDING';
        }

        // Update payment status
        const oldStatus = payment.status;
        payment.status = newStatus;
        await payment.save();
        console.log(`✅ Payment ${payment._id} status updated from ${oldStatus} to ${newStatus}`);

        // Update transaction record if exists
        if (Transaction) {
            const transaction = await Transaction.findOne({ transactionId });
            if (transaction) {
                transaction.status = newStatus;
                await transaction.save();
                console.log(`✅ Transaction ${transaction._id} status updated to ${newStatus}`);
            }
        }

        // ✅ ONLY status update – no business logic (orders, accounts, referrals)

        return res.status(200).json({
            success: true,
            message: 'Webhook processed successfully',
            transactionId,
            status: newStatus
        });

    } catch (error) {
        console.error('❌ Error processing Fapshi webhook:', error);
        // Always return 200 to acknowledge receipt and prevent retries
        return res.status(200).json({
            success: false,
            message: 'Webhook received but processing failed',
            error: error.message
        });
    }
};

/**
 * Get transaction status – fetches latest status from Fapshi and updates local records if changed.
 */
exports.getTransactionStatus = async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    try {
        const { transactionId } = req.params;
        if (!transactionId) {
            return res.status(400).json({ success: false, message: 'Transaction ID is required' });
        }

        // Find local payment
        const payment = await Payment.findOne({ transactionId });
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        // Authorization – only the owner can view
        if (payment.user.toString() !== userId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this transaction' });
        }

        // Fetch fresh status from Fapshi
        let providerStatus = null;
        try {
            providerStatus = await getFapshiTransactionStatus(transactionId);
        } catch (error) {
            console.error('⚠️ Failed to get provider status:', error.message);
        }

        // If provider returned a final status and local is still PENDING, update it
        if (providerStatus?.status && providerStatus.status !== 'PENDING' && payment.status === 'PENDING') {
            let newStatus;
            if (providerStatus.status === 'SUCCESSFUL') newStatus = 'SUCCESSFUL';
            else if (providerStatus.status === 'FAILED') newStatus = 'FAILED';
            else if (providerStatus.status === 'EXPIRED') newStatus = 'EXPIRED';
            else newStatus = 'PENDING';

            payment.status = newStatus;
            await payment.save();

            const transaction = await Transaction.findOne({ transactionId });
            if (transaction) {
                transaction.status = newStatus;
                await transaction.save();
            }

            console.log(`✅ Payment ${payment._id} status updated to ${newStatus} via status check`);
        }

        return res.status(200).json({
            success: true,
            transactionId,
            localStatus: payment.status,
            providerStatus: providerStatus?.status,
            providerData: providerStatus,
            amount: payment.amount,
            from: payment.from,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt
        });

    } catch (error) {
        console.error(`❌ Error fetching transaction status: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

/**
 * Test Fapshi configuration (admin only)
 */
exports.testFapshiConfig = async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const results = {
        timestamp: new Date().toISOString(),
        mode: process.env.FAPSHI_MODE || 'live',
        config: {
            url: process.env.FAPSHI_URL,
            collectionUser: process.env.FAPSHI_API_USER_COLLECTION ? '✅ Set' : '❌ Not set',
            collectionKey: process.env.FAPSHI_API_KEY_COLLECTION ? '✅ Set' : '❌ Not set'
        },
        tests: {}
    };

    // Test base URL
    try {
        const baseResponse = await axios.get(process.env.FAPSHI_URL, {
            timeout: 5000,
            validateStatus: false,
            headers: { 'Accept': 'application/json' }
        });
        results.tests.baseUrl = {
            status: baseResponse.status,
            ok: baseResponse.status >= 200 && baseResponse.status < 400,
            contentType: baseResponse.headers['content-type']
        };
    } catch (error) {
        results.tests.baseUrl = { error: error.message, code: error.code };
    }

    // Test payment endpoint
    try {
        const testPayment = await initiateFapshiPayment(100, "671234567", "API Test - Please Ignore");
        results.tests.payment = {
            success: true,
            status: testPayment.status,
            transId: testPayment.data?.transId
        };
    } catch (error) {
        results.tests.payment = {
            success: false,
            error: error.response?.data || error.message,
            status: error.response?.status
        };
    }

    res.status(200).json({ success: true, message: 'Fapshi configuration test completed', results });
};