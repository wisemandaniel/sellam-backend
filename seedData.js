// scripts/updateBulkOrders.js
const mongoose = require('mongoose');

// MongoDB connection string – use environment variable in production
const MONGODB_URI = "mongodb+srv://wisemandaniel:1rKPAUAHSslmJhdt@cluster0.rcwu5rl.mongodb.net/sellam?retryWrites=true&w=majority&appName=Cluster0";

// Try to import the existing Order model
let Order;
try {
  Order = require('./models/Order');
  console.log('✅ Successfully imported Order model from ./models/Order');
} catch (err) {
  console.warn('⚠️ Could not import Order model, using inline schema as fallback.');
  // Fallback schema – only fields needed for update
  const bulkDataSchema = new mongoose.Schema({
    parcels: [{
      description: String,
      pickupAddress: String,
      pickupContactName: String,
      pickupContactPhone: String,
      deliveryAddress: String,
      receiverName: String,
      receiverPhone: String,
    }]
  }, { _id: false });

  const orderSchema = new mongoose.Schema({
    orderNumber: String,
    type: String,
    bulkData: bulkDataSchema,
    deliveryFee: Number,
    total: Number,
    subtotal: Number,
  }, { collection: 'orders' });

  Order = mongoose.model('Order', orderSchema);
}

async function updateBulkOrders() {
  console.log('🔄 Starting bulk order update script...');

  let session;
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Start session after successful connection
    session = await mongoose.startSession();
    session.startTransaction();

    console.log('📦 Finding all bulk orders...');
    const bulkOrders = await Order.find({ type: 'bulk' }).session(session);
    console.log(`📦 Found ${bulkOrders.length} bulk orders`);

    if (bulkOrders.length === 0) {
      console.log('ℹ️ No bulk orders to update.');
      await session.commitTransaction();
      return;
    }

    let updatedCount = 0;
    for (const order of bulkOrders) {
      const parcelCount = order.bulkData?.parcels?.length || 0;
      const perParcelFee = 750;
      const newDeliveryFee = parcelCount * perParcelFee;

      console.log(`Processing order ${order.orderNumber}: ${parcelCount} parcels → new deliveryFee = ${newDeliveryFee}`);

      order.deliveryFee = newDeliveryFee;
      order.total = newDeliveryFee;
      if (order.subtotal !== undefined) {
        order.subtotal = 0;
      }

      await order.save({ session });
      updatedCount++;
      console.log(`✅ Updated order ${order.orderNumber}`);
    }

    await session.commitTransaction();
    console.log(`🎉 Successfully updated ${updatedCount} bulk orders`);
  } catch (error) {
    console.error('❌ Error during update:', error);
    if (session) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      await session.endSession();
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  updateBulkOrders()
    .then(() => {
      console.log('✨ Script completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 Script failed:', err);
      process.exit(1);
    });
}

module.exports = updateBulkOrders;