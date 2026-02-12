const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const paymentSchema = new Schema({
    order: { type: string, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: false },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    from: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'SUCCESSFUL', 'FAILED'], default: 'PENDING' },
    transactionId: { type: String, required: false },
}, { timestamps: true });

// Add index for better query performance
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);