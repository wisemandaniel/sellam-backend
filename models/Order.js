const mongoose = require("mongoose");
const Order = require("../models/Order");
const Account = require("../models/Account");
const User = require("../models/User");

// Accept delivery - using orderNumber instead of orderId
const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const riderId = req.user._id;

    console.log(`🚀 Rider ${riderId} attempting to accept order ${orderNumber}`);

    if (!orderNumber) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order number is required'
      });
    }

    // 🔍 Check if rider exists
    const rider = await User.findById(riderId).session(session);
    if (!rider) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    // ✅ Profile completeness check
    if (!rider.isProfileComplete) {
      await session.abortTransaction();
      return res.status(200).json({
        success: false,
        message: 'Please complete your profile before accepting deliveries.'
      });
    }

    // ✅ Approval check (specific to riders)
    if (!rider.isApproved) {
      await session.abortTransaction();
      return res.status(200).json({
        success: false,
        message: 'Your account is pending approval. You cannot accept deliveries yet.'
      });
    }

    // 🔍 Check how many active deliveries this rider already has
    const activeCount = await Order.countDocuments({
      rider: riderId,
      status: { $in: ['accepted', 'picked_up'] }
    }).session(session);

    if (activeCount >= 2) {
      await session.abortTransaction();
      return res.status(200).json({
        success: false,
        message: 'You already have 2 active deliveries. Please complete one before accepting a new order.'
      });
    }

    // ✅ Attempt to accept the order
    const order = await Order.findOneAndUpdate(
      {
        orderNumber: orderNumber,
        status: 'confirmed'
      },
      {
        status: 'accepted',
        rider: riderId,
        acceptedAt: new Date(),
        $inc: { __v: 1 }
      },
      {
        new: true,
        session,
        runValidators: true
      }
    ).populate('user', 'name phone')
     .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name address deliveryTime coordinates phone'
        }
      });

    if (!order) {
      await session.abortTransaction();
      console.log(`❌ Order ${orderNumber} not found or already taken`);
      return res.status(404).json({
        success: false,
        message: 'Order not found or already accepted by another rider'
      });
    }

    // Update rider's account stats
    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      account = await Account.create([{
        user: riderId,
        status: 'active',
        vehicleType: 'bike'
      }], { session });
      account = account[0];
    }

    account.incrementAccepted();
    account.updatePerformance(order);
    await account.save({ session });

    await session.commitTransaction();
    console.log(`✅ Order ${orderNumber} successfully accepted by rider ${riderId} at ${order.acceptedAt}`);

    // Build response data
    const responseData = {
      _id: order._id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      total: order.total,
      deliveryFee: order.deliveryFee,
      customer: {
        name: order.user?.name || 'Customer',
        phone: order.user?.phone || order.phone
      },
      deliveryAddress: order.deliveryAddress,
      acceptedAt: order.acceptedAt,
      createdAt: order.createdAt
    };

    switch (order.type) {
      case 'business':
        responseData.items = order.items.map(item => ({
          name: item.product?.name || 'Product not found',
          images: item.product?.images || [],
          featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          business: {
            name: item.product?.business?.name || 'Business not found',
            address: item.product?.business?.address || '',
            phone: item.product?.business?.phone || '',
            deliveryTime: item.product?.business?.deliveryTime || 'N/A',
            coordinates: item.product?.business?.coordinates || null
          }
        }));
        break;

      case 'errand':
        if (order.errandType) {
          responseData.errandType = order.errandType;
          switch (order.errandType) {
            case 'shopping':
              responseData.shoppingErrand = order.shoppingErrand;
              break;
            case 'bill':
              responseData.billErrand = order.billErrand;
              break;
            case 'document':
              responseData.documentErrand = order.documentErrand;
              break;
          }
        }
        if (order.errandItems && order.errandItems.length > 0) {
          responseData.errandItems = order.errandItems;
        }
        break;

      case 'ticket':
        responseData.ticketData = order.ticketData;
        break;

      case 'random':
        responseData.deliveryData = order.deliveryData;
        break;

      case 'bulk':
        responseData.bulkData = order.bulkData;
        break;
    }

    res.json({
      success: true,
      data: responseData,
      message: 'Delivery accepted successfully!'
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ ACCEPT DELIVERY - Error:', error);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order number'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to accept delivery',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

module.exports = { acceptDelivery };