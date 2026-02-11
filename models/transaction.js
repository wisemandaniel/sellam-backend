const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transactionSchema = new Schema({
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: false },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: false },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'XAF' },
    from: { type: Schema.Types.ObjectId, ref: 'User', required: false }, 
    status: { 
        type: String, 
        enum: ['PENDING', 'SUCCESSFUL', 'FAILED'], default: 'PENDING' 
    },
    transactionId: { type: String, required: false },
    type: { 
        type: String, 
        enum: ['TOP UP', 'WITHDRAWAL', 'PAYMENT', 'REFERRAL', 'TRANSFER'], 
        required: true 
    },
    refType: {
        type: String,
        enum: ['REWARD', 'WITHDRAWAL', 'TRANSFER'],
        required: false
    },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);