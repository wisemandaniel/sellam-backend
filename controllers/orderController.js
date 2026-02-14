/**
 * controllers/orderController.js
 * Full delivery/order logic with all route handlers.
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const Account = require("../models/Account");
const User = require("../models/User");
const twilio = require("twilio");
const Store = require("../models/Store");
const Business = require("../models/Business");
const mongoose = require("mongoose");

// Initialize Twilio client
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log("✅ Twilio client initialized");
} else {
  console.log("⚠️ Twilio not configured - WhatsApp templates disabled");
}

// Generate order number
const generateOrderNumber = async () => {
  const count = await Order.countDocuments();
  return `ORD${Date.now()}${count + 1}`;
};

// Helper function to format price
const formatPrice = (price) => {
  return `XAF ${Math.round(price).toLocaleString()}`;
};

// ================================
// ORDER TYPE VALIDATION FUNCTIONS
// ================================

// Validate errand items
const validateErrandItems = (items) => {
  if (!items || items.length === 0) {
    throw new Error("Errand must have at least one item");
  }

  return items.map((item, index) => {
    if (!item.name || !item.price) {
      throw new Error(`Item ${index + 1}: name and price are required`);
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      throw new Error(`Item ${index + 1}: price must be a positive number`);
    }
    if (!item.quantity || item.quantity < 1) {
      throw new Error(`Item ${index + 1}: quantity must be at least 1`);
    }
    return {
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      description: item.description || ''
    };
  });
};

// Validate ticket booking
const validateTicketBooking = (data) => {
  // Required fields (must be present)
  if (!data.busAgency || !data.seatNumber || !data.passengerName || !data.departureTime || !data.destination) {
    throw new Error('Missing required ticket booking fields: busAgency, seatNumber, passengerName, departureTime, destination');
  }

  // Return the data as is (with defaults for missing optional fields)
  return {
    busAgency: data.busAgency,
    seatNumber: data.seatNumber,
    passengerName: data.passengerName,
    departureTime: data.departureTime,
    destination: data.destination,
    price: data.price || 0,
    backupSeats: data.backupSeats || [],
    travelTimeOfDay: data.travelTimeOfDay || 'morning',
    passengerIDNumber: data.passengerIDNumber || '',
    idPhotoFront: data.idPhotoFront || '',
    idPhotoBack: data.idPhotoBack || '',
    agencyDetails: data.agencyDetails || {},
    serviceFee: data.serviceFee || 1500,
    pricePerSeat: data.pricePerSeat || 0,
    seatCount: data.seatCount || 0
  };
};

// Validate random delivery
const validateRandomDelivery = (deliveryData) => {
  // 🔍 LOG THE INCOMING DATA
  console.log('🔍 validateRandomDelivery received:', JSON.stringify(deliveryData, null, 2));

  const { pickupAddress, deliveryAddress, senderNumber, receiverNumber, itemDescription } = deliveryData;
  
  if (!pickupAddress) {
    throw new Error("Pickup address is required for random delivery");
  }
  if (!deliveryAddress) {
    throw new Error("Delivery address is required for random delivery");
  }
  if (!senderNumber) {
    throw new Error("Sender number is required for random delivery");
  }
  if (!receiverNumber) {
    throw new Error("Receiver number is required for random delivery");
  }
  if (!itemDescription) {
    throw new Error("Item description is required for random delivery");
  }

  return {
    pickupAddress,
    deliveryAddress,
    senderNumber,
    receiverNumber,
    itemDescription,
    price: deliveryData.price || 0
  };
};

// Validate business order (FIXED - business is in product schema)
const validateBusinessOrder = async (items) => {
  if (!items || items.length === 0) {
    throw new Error("No items in order");
  }

  let subtotal = 0;
  const orderItems = [];
  const businessDeliveryFees = new Map();
  const businessIds = new Set();

  for (const item of items) {
    // FIX: Populate business from product
    const product = await Product.findById(item.product).populate("business");

    if (!product) {
      throw new Error(`Product not found: ${item.product}`);
    }

    if (!product.inStock) {
      throw new Error(`${product.name} is out of stock`);
    }

    // FIX: Check if product has a business associated
    if (!product.business) {
      throw new Error(`Product ${product.name} is not associated with any business`);
    }

    const price = product.discount > 0
      ? product.price * (1 - product.discount / 100)
      : product.price;

    const itemTotal = price * item.quantity;
    subtotal += itemTotal;

    // FIX: Use business from product
    const businessId = product.business._id.toString();
    businessIds.add(businessId);

    if (!businessDeliveryFees.has(businessId)) {
      businessDeliveryFees.set(businessId, product.business.deliveryFee || 1000);
    }

    orderItems.push({
      product: product._id,
      // FIX: Store business reference in order item
      business: product.business._id,
      quantity: item.quantity,
      price: price,
    });
  }

  // Calculate delivery fee
  const totalBusinessDeliveryFees = Array.from(
    businessDeliveryFees.values()
  ).reduce((sum, fee) => sum + fee, 0);
  const deliveryFee = Math.round(totalBusinessDeliveryFees);
  const total = subtotal + deliveryFee;

  return {
    orderItems,
    subtotal,
    deliveryFee,
    total,
    businessIds: Array.from(businessIds)
  };
};

// ================================
// WHATSAPP TEMPLATE FUNCTIONALITY
// ================================

// Template 1: Order Notification (5 variables - PRIVACY COMPLIANT)
const sendWhatsAppTemplate = async (order, businessIds) => {
  if (!twilioClient || !process.env.WHATSAPP_TEMPLATE_SID) {
    console.log("⚠️ WhatsApp templates not configured");
    return { success: false, message: "WhatsApp templates not configured" };
  }

  try {
    console.log("📱 Sending WhatsApp template notifications...");

    const businesses = await Store.find({ _id: { $in: businessIds } }).select(
      "name phone whatsappNumber"
    );
    let sentCount = 0;

    for (const business of businesses) {
      const businessPhone = business.whatsappNumber || business.phone;
      if (!businessPhone) {
        console.log(`❌ No phone number for ${business.name}`);
        continue;
      }

      const businessItems = order.items.filter(
        (item) =>
          item.business &&
          item.business._id &&
          item.business._id.toString() === business._id.toString()
      );

      if (businessItems.length === 0) {
        console.log(`❌ No items for ${business.name}`);
        continue;
      }

      // Format items list
      const itemsList = businessItems
        .map((item) => `${item.quantity}x ${item.product.name}`)
        .join(", ");

      const businessSubtotal = businessItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // Template variables (NO CUSTOMER PHONE - Privacy compliant)
      const contentVariables = {
        1: order.orderNumber, // Order number
        2: order.user?.name || "Customer", // Customer name (no phone)
        3: itemsList, // Items list
        4: formatPrice(businessSubtotal), // Total amount
        5: order.deliveryAddress, // Delivery address
      };

      try {
        let formattedPhone = businessPhone.replace(/\D/g, "");
        if (!formattedPhone.startsWith("237") && formattedPhone.length === 9) {
          formattedPhone = "237" + formattedPhone;
        }

        const result = await twilioClient.messages.create({
          contentSid: process.env.WHATSAPP_TEMPLATE_SID,
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: `whatsapp:+${formattedPhone}`,
          contentVariables: JSON.stringify(contentVariables),
        });

        console.log(`✅ Template sent to ${business.name}`);
        console.log(`   📞 ${businessPhone} | Status: ${result.status}`);
        sentCount++;
      } catch (twilioError) {
        console.error(
          `❌ Failed to send template to ${business.name}:`,
          twilioError.message
        );

        if (twilioError.code === 63016) {
          console.log("💡 Template not approved or outside 24-hour window");
        }
      }
    }

    return {
      success: sentCount > 0,
      sentCount,
      totalBusinesses: businesses.length,
      message: `WhatsApp templates sent to ${sentCount}/${businesses.length} businesses`,
    };
  } catch (error) {
    console.error("🚨 WhatsApp template error:", error);
    return { success: false, error: error.message };
  }
};

// WhatsApp URL fallback (when templates fail)
const generateWhatsAppURLs = async (order, businessIds) => {
  console.log("\n🔗 ========== WHATSAPP URL NOTIFICATIONS ==========");
  console.log("📱 PRIVACY: Customer phone numbers excluded");
  console.log("💡 INSTRUCTIONS: Click URLs to send manually");
  console.log("====================================================\n");

  const businesses = await Store.find({ _id: { $in: businessIds } }).select(
    "name phone whatsappNumber"
  );
  let urlCount = 0;

  businesses.forEach((business, index) => {
    const businessPhone = business.whatsappNumber || business.phone;
    if (!businessPhone) {
      console.log(`❌ ${index + 1}. ${business.name}: No phone number`);
      return;
    }

    const businessItems = order.items.filter(
      (item) =>
        item.business &&
        item.business._id &&
        item.business._id.toString() === business._id.toString()
    );

    if (businessItems.length === 0) {
      console.log(`❌ ${index + 1}. ${business.name}: No items`);
      return;
    }

    // Format items with prices
    const itemsList = businessItems
      .map(
        (item) =>
          `${item.quantity}x ${item.product.name} - ${formatPrice(
            item.price * item.quantity
          )}`
      )
      .join("%0A");

    const businessSubtotal = businessItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Message WITHOUT customer phone (Privacy compliant)
    const message =
      `NEW ORDER RECEIVED%0A%0A` +
      `Order Number: ${order.orderNumber}%0A` +
      `Customer Name: ${order.user?.name || "Customer"}%0A%0A` +
      `YOUR ITEMS:%0A${itemsList}%0A%0A` +
      `Business Subtotal: ${formatPrice(businessSubtotal)}%0A%0A` +
      `Delivery Address: ${order.deliveryAddress}%0A%0A` +
      `Order Notes: ${order.notes || "No special instructions"}%0A%0A` +
      `Please confirm receipt and preparation time.`;

    const formattedPhone = businessPhone.replace(/\D/g, "");
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${message}`;

    console.log(`✅ ${index + 1}. ${business.name}`);
    console.log(`   📞 Business: ${businessPhone}`);
    console.log(
      `   👤 Customer: ${order.user?.name || "Customer"} (phone protected)`
    );
    console.log(
      `   📦 ${businessItems.length} item(s) - ${formatPrice(businessSubtotal)}`
    );
    console.log(`   🔗 ${whatsappUrl}`);
    console.log("");

    urlCount++;
  });

  console.log("====================================================");
  console.log(`📊 SUMMARY: ${urlCount} WhatsApp URL(s) generated`);
  console.log("✅ Privacy: Customer phone numbers protected");
  console.log("====================================================\n");

  return urlCount;
};

// Hybrid notification system (templates + fallback)
const sendStoreNotifications = async (order, businessIds) => {
  console.log("\n🎯 ========== BUSINESS NOTIFICATIONS ==========");

  // Try templates first
  const templateResult = await sendWhatsAppTemplate(order, businessIds);

  if (!templateResult.success || templateResult.sentCount === 0) {
    console.log("🔄 Falling back to WhatsApp URLs...");
    const urlCount = await generateWhatsAppURLs(order, businessIds);
    return {
      method: "urls",
      count: urlCount,
      message: `Generated ${urlCount} WhatsApp URLs for manual sending`,
    };
  }

  return {
    method: "templates",
    count: templateResult.sentCount,
    message: templateResult.message,
  };
};

// Send order notifications based on type
const sendOrderNotifications = async (order) => {
  try {
    console.log(`📱 Sending notifications for ${order.type} order ${order.orderNumber}`);

    let notificationResult = { method: 'none', count: 0, message: 'No notifications sent' };

    switch (order.type) {
      case 'business':
        // Notify businesses about their products
        const businessIds = [...new Set(order.items.map(item => item.business?.toString()).filter(Boolean))];
        if (businessIds.length > 0) {
          notificationResult = await sendStoreNotifications(order, businessIds);
        }
        break;

      case 'errand':
        // For errands, notify admin about new errand request
        const errandMessage = `
NEW ERRAND REQUEST
Order: ${order.orderNumber}
Customer: ${order.user?.name || 'Customer'}
Items: ${order.errandItems.map(item => `${item.quantity}x ${item.name} - ${formatPrice(item.price)}`).join(', ')}
Total: ${formatPrice(order.total)}
Delivery: ${order.deliveryAddress}
Phone: ${order.phone}
        `.trim();
        console.log('📋 Errand Details:', errandMessage);
        notificationResult = { method: 'errand', count: 1, message: 'Errand notifications sent to admin' };
        break;

      case 'ticket':
        // For tickets, notify ticket agencies or admin
        const ticketMessage = `
NEW TICKET BOOKING
Order: ${order.orderNumber}
Agency: ${order.ticketData.busAgency}
Destination: ${order.ticketData.destination}
Seat: ${order.ticketData.seatNumber}
Departure: ${order.ticketData.departureTime}
Customer: ${order.user?.name || 'Customer'}
ID: ${order.ticketData.idCard}
Phone: ${order.phone}
        `.trim();
        console.log('🎟️ Ticket Details:', ticketMessage);
        notificationResult = { method: 'ticket', count: 1, message: 'Ticket notifications sent to agency' };
        break;

      case 'random':
        // For random delivery, notify available delivery riders
        const deliveryMessage = `
NEW RANDOM DELIVERY
Order: ${order.orderNumber}
Item: ${order.deliveryData.itemDescription}
Pickup: ${order.deliveryData.pickupAddress}
Delivery: ${order.deliveryData.deliveryAddress}
Sender: ${order.deliveryData.senderNumber}
Receiver: ${order.deliveryData.receiverNumber}
Customer: ${order.user?.name || 'Customer'}
Phone: ${order.phone}
        `.trim();
        console.log('🚚 Delivery Details:', deliveryMessage);
        notificationResult = { method: 'random', count: 1, message: 'Delivery notifications sent to riders' };
        break;
    }

    return notificationResult;
  } catch (error) {
    console.error('❌ Notification error:', error);
    return { method: 'error', count: 0, message: error.message };
  }
};

// ================================
// ORDER CREATION - ALL TYPES
// ================================

// Create new order (supports all types)
const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
      type = 'business',
      items, 
      deliveryAddress, 
      phone, 
      notes,
      errandItems,
      busAgency, seatNumber, idCard, departureTime, destination, ticketPrice,
      pickupAddress, deliveryAddress: randomDeliveryAddress, senderNumber, receiverNumber, itemDescription, deliveryPrice
    } = req.body;

    console.log('📥 Incoming createOrder request body:', JSON.stringify(req.body, null, 2));

    if (!req.user) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    if (!['business', 'errand', 'ticket', 'random'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Valid order type is required (business, errand, ticket, random)"
      });
    }

    if (!deliveryAddress || !phone) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Delivery address and phone are required",
      });
    }

    let orderData = {
      user: req.user._id,
      type,
      deliveryAddress,
      phone,
      notes: notes || "",
    };

    let businessIds = [];
    let calculatedTotal = 0;
    let calculatedSubtotal = 0;
    let calculatedDeliveryFee = 0;

    switch (type) {
      case 'business':
        const businessResult = await validateBusinessOrder(items);
        orderData.items = businessResult.orderItems;
        orderData.subtotal = businessResult.subtotal;
        orderData.deliveryFee = businessResult.deliveryFee;
        orderData.total = businessResult.total;
        businessIds = businessResult.businessIds;
        break;

      case 'errand':
        const validatedErrandItems = validateErrandItems(errandItems);
        orderData.errandItems = validatedErrandItems;
        calculatedSubtotal = validatedErrandItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        calculatedDeliveryFee = calculatedSubtotal * 0.3;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;

      case 'ticket':
        // Base ticket details from request body (frontend sends idCard as passenger name)
        let ticketDetails = {
          busAgency,
          seatNumber,
          passengerName: idCard,   // map idCard to passengerName
          departureTime,
          destination,
          price: ticketPrice,      // total amount from frontend (seats*pricePerSeat + serviceFee)
        };

        // Parse notes if it contains a JSON string (as sent by the frontend)
        let parsedNotes = {};
        if (notes && typeof notes === 'string' && notes.trim().startsWith('{')) {
          try {
            parsedNotes = JSON.parse(notes);
          } catch (e) {
            console.warn('Could not parse notes JSON for ticket booking:', e.message);
          }
        }

        // Extend ticketDetails with parsed data
        ticketDetails = {
          ...ticketDetails,
          backupSeats: parsedNotes.backupSeats || [],
          travelTimeOfDay: parsedNotes.travelTimeOfDay || 'morning',
          passengerIDNumber: parsedNotes.passengerIDNumber || '',
          idPhotoFront: parsedNotes.idPhotos?.front || '',
          idPhotoBack: parsedNotes.idPhotos?.back || '',
          agencyDetails: parsedNotes.agencyDetails || {},
          serviceFee: parsedNotes.serviceFee || 1500,
          pricePerSeat: parsedNotes.pricePerSeat || 0,
          seatCount: parsedNotes.seatCount || (seatNumber ? seatNumber.split(',').length : 0)
        };

        // Validate the complete ticket data
        const ticketData = validateTicketBooking(ticketDetails);
        orderData.ticketData = ticketData;

        // Calculate financials based on parsed data (avoid using ticketPrice directly if it may double-count)
        const seatPriceTotal = ticketData.pricePerSeat * ticketData.seatCount;
        const serviceFee = ticketData.serviceFee;

        orderData.subtotal = seatPriceTotal;
        orderData.deliveryFee = serviceFee;
        orderData.total = seatPriceTotal + serviceFee;

        // Clear notes because we've extracted all data into ticketData
        orderData.notes = '';

        break;

      case 'random':
        const deliveryData = validateRandomDelivery({
          pickupAddress: pickupAddress || deliveryAddress,
          deliveryAddress: randomDeliveryAddress || deliveryAddress,
          senderNumber,
          receiverNumber,
          itemDescription,
          price: deliveryPrice
        });
        orderData.deliveryData = deliveryData;
        calculatedSubtotal = deliveryData.price || 0;
        calculatedDeliveryFee = 1000;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();
    orderData.orderNumber = orderNumber;

    // 🔍 LOG THE FINAL ORDER DATA BEFORE CREATION
    console.log('📦 Final orderData before create:', JSON.stringify(orderData, null, 2));

    // Create order
    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    console.log('✅ Order created successfully:', createdOrder._id);

    // Populate order data
    await createdOrder.populate('user', 'name phone');
    
    if (type === 'business') {
      await createdOrder.populate({
        path: "items.product",
        select: "name images price featuredImage business",
        populate: {
          path: "business",
          select: "name deliveryTime phone address"
        }
      });
    }

    // Send notifications (non-blocking)
    const notificationResult = await sendOrderNotifications(createdOrder);

    await session.commitTransaction();

    let responseData = {
      orderNumber: createdOrder.orderNumber,
      type: createdOrder.type,
      status: createdOrder.status,
      total: createdOrder.total,
      deliveryFee: createdOrder.deliveryFee,
      subtotal: createdOrder.subtotal,
      deliveryAddress: createdOrder.deliveryAddress,
      phone: createdOrder.phone,
      notes: createdOrder.notes,
      createdAt: createdOrder.createdAt,
    };

    switch (type) {
      case 'business':
        responseData.items = createdOrder.items.map((item) => ({
          name: item.product.name,
          images: item.product.images || [],
          featuredImage: item.product.featuredImage || (item.product.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          business: item.product.business?.name || 'Business not found',
          deliveryTime: item.product.business?.deliveryTime || 'N/A',
        }));
        break;
      case 'errand':
        responseData.errandItems = createdOrder.errandItems;
        break;
      case 'ticket':
        responseData.ticketData = createdOrder.ticketData;
        break;
      case 'random':
        responseData.deliveryData = createdOrder.deliveryData;
        break;
    }

    res.status(201).json({
      success: true,
      data: responseData,
      notifications: notificationResult,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} order created successfully!`,
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Order creation error:", error);
    console.error("Stack trace:", error.stack);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Order number conflict. Please try again.",
      });
    }

    if (error.name === 'ValidationError' || error.message.includes('required')) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error creating order",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Cancel an order (customer only)
 * @route   PATCH /api/orders/:orderId/cancel
 * @access  Private (order owner)
 */
/**
 * @desc    Cancel an order (customer only) - using orderNumber
 * @route   PATCH /api/orders/order-number/:orderNumber/cancel
 * @access  Private (order owner)
 */
const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;

    // Find the order by orderNumber and ensure it belongs to the authenticated user
    const order = await Order.findOne({
      orderNumber: orderNumber,
      user: userId,
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Order not found or you are not authorized',
      });
    }

    // Only allow cancellation if order is still pending
    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in "${order.status}" status. Only pending orders can be cancelled.`,
      });
    }

    // Update order status to cancelled
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        cancelledAt: order.cancelledAt,
      },
      message: 'Order cancelled successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Delete an order (customer only) - using orderNumber
 * @route   DELETE /api/orders/order-number/:orderNumber
 * @access  Private (order owner)
 */
const deleteMyOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;

    console.log('orderNumber:::', orderNumber);
    

    // Find order by orderNumber and ensure it belongs to the user
    const order = await Order.findOne({
      orderNumber: orderNumber,
      user: userId,
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Order not found or you are not authorized',
      });
    }

    // Only allow deletion if order is cancelled or still pending
    if (!['cancelled', 'pending'].includes(order.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot delete order in "${order.status}" status. Only cancelled or pending orders can be deleted.`,
      });
    }

    await Order.deleteOne({ _id: order._id }).session(session);
    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Order deleted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Delete order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Create order for user (admin only)
// @route   POST /api/orders/admin/create
// @access  Private/Admin
const createOrderForUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
      userId,
      type = 'business',
      items, 
      deliveryAddress, 
      phone, 
      notes,
      // Errand specific
      errandItems,
      // Ticket specific
      busAgency, seatNumber, idCard, departureTime, destination, ticketPrice,
      // Random delivery specific
      pickupAddress, deliveryAddress: randomDeliveryAddress, senderNumber, receiverNumber, itemDescription, deliveryPrice
    } = req.body;

    // Validate admin permissions
    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required."
      });
    }

    // Validate required fields
    if (!userId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "User ID is required to create order on behalf of user"
      });
    }

    if (!['business', 'errand', 'ticket', 'random'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Valid order type is required (business, errand, ticket, random)"
      });
    }

    if (!deliveryAddress || !phone) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Delivery address and phone are required",
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    let orderData = {
      user: userId,
      type,
      deliveryAddress,
      phone,
      notes: notes || "",
      createdBy: req.user._id,
      isAdminCreated: true
    };

    let businessIds = [];
    let calculatedTotal = 0;
    let calculatedSubtotal = 0;
    let calculatedDeliveryFee = 0;

    // Process based on order type
    switch (type) {
      case 'business':
        if (!items || items.length === 0) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "No items in order",
          });
        }

        const businessResult = await validateBusinessOrder(items);
        orderData.items = businessResult.orderItems;
        orderData.subtotal = businessResult.subtotal;
        orderData.deliveryFee = businessResult.deliveryFee;
        orderData.total = businessResult.total;
        businessIds = businessResult.businessIds;
        break;

      case 'errand':
        const validatedErrandItems = validateErrandItems(errandItems);
        orderData.errandItems = validatedErrandItems;
        
        calculatedSubtotal = validatedErrandItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        calculatedDeliveryFee = 1000;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;

      case 'ticket':
        const ticketData = validateTicketBooking({
          busAgency, seatNumber, idCard, departureTime, destination, price: ticketPrice
        });
        orderData.ticketData = ticketData;
        
        calculatedSubtotal = ticketData.price || 5000;
        calculatedDeliveryFee = 1000;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;

      case 'random':
        const deliveryData = validateRandomDelivery({
          pickupAddress: pickupAddress || deliveryAddress,
          deliveryAddress: randomDeliveryAddress || deliveryAddress,
          senderNumber,
          receiverNumber,
          itemDescription,
          price: deliveryPrice
        });
        orderData.deliveryData = deliveryData;
        
        calculatedSubtotal = deliveryData.price || 2000;
        calculatedDeliveryFee = 1000;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();
    orderData.orderNumber = orderNumber;

    // Create order
    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    // Populate order data
    await createdOrder.populate('user', 'name phone email');
    
    if (type === 'business') {
      // FIX: Populate product and then business from product
      await createdOrder.populate({
        path: "items.product",
        select: "name images price featuredImage business",
        populate: {
          path: "business",
          select: "name deliveryTime phone address"
        }
      });
    }

    // Send notifications
    const notificationResult = await sendOrderNotifications(createdOrder);

    await session.commitTransaction();

    // Format response
    let responseData = {
      orderNumber: createdOrder.orderNumber,
      type: createdOrder.type,
      status: createdOrder.status,
      total: createdOrder.total,
      deliveryFee: createdOrder.deliveryFee,
      subtotal: createdOrder.subtotal,
      customer: {
        name: createdOrder.user.name,
        phone: createdOrder.user.phone,
        email: createdOrder.user.email
      },
      deliveryAddress: createdOrder.deliveryAddress,
      phone: createdOrder.phone,
      notes: createdOrder.notes,
      createdAt: createdOrder.createdAt,
      createdBy: 'admin'
    };

    // Add type-specific data
    switch (type) {
      case 'business':
        responseData.items = createdOrder.items.map((item) => ({
          name: item.product.name,
          images: item.product.images || [],
          featuredImage: item.product.featuredImage || (item.product.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          // FIX: Get business from product.business
          business: item.product.business?.name || 'Business not found',
          deliveryTime: item.product.business?.deliveryTime || 'N/A',
        }));
        break;

      case 'errand':
        responseData.errandItems = createdOrder.errandItems;
        break;

      case 'ticket':
        responseData.ticketData = createdOrder.ticketData;
        break;

      case 'random':
        responseData.deliveryData = createdOrder.deliveryData;
        break;
    }

    res.status(201).json({
      success: true,
      data: responseData,
      notifications: notificationResult,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} order created successfully for user!`,
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Admin order creation error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Order number conflict. Please try again.",
      });
    }

    if (error.name === 'ValidationError' || error.message.includes('required')) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error creating order for user",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Get user orders
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name deliveryTime'
        }
      })
      // FIX: Add paymentStatus and paymentMethod to select
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt deliveredAt paymentStatus paymentMethod')
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map(order => {
      const baseOrder = {
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        // FIX: Add payment fields to response
        paymentStatus: order.paymentStatus || 'unpaid', // Default to unpaid if not set
        paymentMethod: order.paymentMethod || 'cash',   // Default to cash if not set
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes,
        acceptedAt: order.acceptedAt,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt
      };

      // Add type-specific data
      switch (order.type) {
        case 'business':
          baseOrder.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            // FIX: Get business from product.business
            business: item.product?.business?.name || 'Business not found',
            deliveryTime: item.product?.business?.deliveryTime || 'N/A'
          }));
          break;

        case 'errand':
          baseOrder.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;
      }

      return baseOrder;
    });

    // Debug log to verify payment status is being returned
    console.log('✅ getMyOrders - Payment status check:');
    formattedOrders.forEach(order => {
      console.log(`   Order ${order.orderNumber}: paymentStatus = ${order.paymentStatus}, paymentMethod = ${order.paymentMethod}`);
    });

    res.json({
      success: true,
      data: formattedOrders
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get single order
const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("rider", "name phone")
      .populate("user", "name phone")
      .populate({
        path: "items.product",
        select: "name images price featuredImage business",
        populate: {
          path: "business",
          select: "name address phone"
        }
      });
      
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }
    
    // Format the response to include type-specific data
    const formattedOrder = {
      ...order.toObject(),
      items: order.type === 'business' ? order.items.map(item => ({
        ...item,
        product: {
          ...item.product,
          images: item.product?.images || [],
          featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
          business: item.product?.business || null
        }
      })) : undefined
    };
    
    res.json({ 
      success: true, 
      data: formattedOrder 
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// Get all pending orders (for riders/drivers)
const getPendingOrders = async (req, res) => {
  try {
    console.log('📦 Fetching pending orders...');

    const pendingOrders = await Order.find({ status: 'pending' })
      .populate({
        path: 'user',
        select: 'name phone'
      })
      .populate({
        path: 'items.product',
        select: 'name images price category featuredImage business',
        populate: {
          path: 'business',
          select: 'name phone address deliveryTime coordinates'
        }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt updatedAt')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${pendingOrders.length} pending orders`);

    const formattedOrders = pendingOrders.map(order => {
      const baseOrder = {
        _id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone
        },
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || 'No special instructions',
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseOrder.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: {
              name: item.product?.business?.name || 'Business not found',
              phone: item.product?.business?.phone || '',
              address: item.product?.business?.address || '',
              deliveryTime: item.product?.business?.deliveryTime || 'N/A',
              coordinates: item.product?.business?.coordinates || null
            }
          }));
          break;

        case 'errand':
          baseOrder.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          // Also include pickup address for random deliveries
          if (order.deliveryData?.pickupAddress) {
            baseOrder.pickupAddress = order.deliveryData.pickupAddress;
          }
          break;
      }

      return baseOrder;
    });

    res.json({
      success: true,
      count: formattedOrders.length,
      data: formattedOrders,
      message: `Found ${formattedOrders .length} pending orders`
    });

  } catch (error) {
    console.error('❌ Get pending orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending orders',
      error: error.message
    });
  }
};

// [NEW] Get rider's completed deliveries
const getMyCompletedDeliveries = async (req, res) => {
  try {
    const riderId = req.user._id;

    console.log(`📦 Fetching completed deliveries for rider ${riderId}`);

    const completedDeliveries = await Order.find({
      rider: riderId,
      status: 'delivered'
    })
    .populate('user', 'name phone')
    .populate({
      path: 'items.product',
      select: 'name images price featuredImage business',
      populate: {
        path: 'business',
        select: 'name address deliveryTime coordinates phone'
      }
    })
    .select('orderNumber type status total deliveryFee items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt')
    .sort({ deliveredAt: -1 })
    .lean();

    console.log(`✅ Found ${completedDeliveries.length} completed deliveries for rider ${riderId}`);

    const formattedDeliveries = completedDeliveries.map(order => {
      const baseDelivery = {
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
        phone: order.phone,
        notes: order.notes || '',
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseDelivery.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: {
              name: item.product?.business?.name || 'Business not found',
              phone: item.product?.business?.phone || '',
              address: item.product?.business?.address || '',
              deliveryTime: item.product?.business?.deliveryTime || 'N/A',
              coordinates: item.product?.business?.coordinates || null
            }
          }));
          break;

        case 'errand':
          baseDelivery.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseDelivery.ticketData = order.ticketData;
          break;

        case 'random':
          baseDelivery.deliveryData = order.deliveryData;
          break;
      }

      return baseDelivery;
    });

    res.json({
      success: true,
      count: formattedDeliveries.length,
      data: formattedDeliveries,
      message: `Found ${formattedDeliveries.length} completed deliveries`
    });

  } catch (error) {
    console.error('❌ GET COMPLETED DELIVERIES - Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completed deliveries',
      error: error.message
    });
  }
};

// [FIXED] Accept delivery with proper acceptedAt and account updates
const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const riderId = req.user._id;

    console.log(`🚀 Rider ${riderId} attempting to accept order ${orderId}`);

    // Validate input
    if (!orderId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    // Find and update order with acceptedAt
    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: 'pending'
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
      console.log(`❌ Order ${orderId} not found or already taken`);
      return res.status(404).json({
        success: false,
        message: 'Order not found or already accepted by another rider'
      });
    }

    // Update rider's account with performance data
    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      // Create account if it doesn't exist
      account = await Account.create([{
        user: riderId,
        status: 'active',
        vehicleType: 'bike'
      }], { session });
      account = account[0];
    }

    // ✅ FIX: Update account performance with the accepted order
    account.incrementAccepted();
    account.updatePerformance(order); // This will include acceptedAt
    await account.save({ session });

    await session.commitTransaction();
    console.log(`✅ Order ${orderId} successfully accepted by rider ${riderId} at ${order.acceptedAt}`);

    // Format response
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
      acceptedAt: order.acceptedAt, // ✅ Now properly set
      createdAt: order.createdAt
    };

    // Add type-specific items
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
        responseData.errandItems = order.errandItems;
        break;

      case 'ticket':
        responseData.ticketData = order.ticketData;
        break;

      case 'random':
        responseData.deliveryData = order.deliveryData;
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
        message: 'Invalid order ID'
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

// [FIXED] Reject delivery with account updates
const rejectDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const riderId = req.user._id;

    console.log(`🚫 Rider ${riderId} rejecting order ${orderId}`);

    if (!orderId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: 'pending'
      },
      {
        status: 'rejected',
        rejectedBy: riderId,
        rejectedAt: new Date(),
        $inc: { __v: 1 }
      },
      {
        new: true,
        session,
        runValidators: true
      }
    );

    if (!order) {
      await session.abortTransaction();
      console.log(`❌ Order ${orderId} not found or not available for rejection`);
      return res.status(404).json({
        success: false,
        message: 'Order not found or cannot be rejected'
      });
    }

    // Update rider's account with rejection data
    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      account = await Account.create([{
        user: riderId,
        status: 'active',
        vehicleType: 'bike'
      }], { session });
      account = account[0];
    }

    // ✅ FIX: Update account with rejected order data
    account.updatePerformance(order, 'rejected');
    await account.save({ session });

    await session.commitTransaction();
    console.log(`✅ Order ${orderId} rejected by rider ${riderId}`);

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        rejectedAt: order.rejectedAt
      },
      message: 'Delivery rejected successfully'
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ REJECT DELIVERY - Error:', error);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to reject delivery',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Get rider's active deliveries
const getMyActiveDeliveries = async (req, res) => {
  try {
    const riderId = req.user._id;

    console.log(`📦 Fetching active deliveries for rider ${riderId}`);

    const activeDeliveries = await Order.find({
      rider: riderId,
      status: { $in: ['accepted', 'picked_up'] }
    })
    .populate('user', 'name phone')
    .populate({
      path: 'items.product',
      select: 'name images price featuredImage business',
      populate: {
        path: 'business',
        select: 'name address deliveryTime coordinates phone'
      }
    })
    .select('orderNumber type status total deliveryFee items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt')
    .sort({ acceptedAt: -1 })
    .lean();

    console.log(`✅ Found ${activeDeliveries.length} active deliveries for rider ${riderId}`);

    const formattedDeliveries = activeDeliveries.map(order => {
      const baseDelivery = {
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
        phone: order.phone,
        notes: order.notes || '',
        acceptedAt: order.acceptedAt, // ✅ Now properly included
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseDelivery.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: {
              name: item.product?.business?.name || 'Business not found',
              phone: item.product?.business?.phone || '',
              address: item.product?.business?.address || '',
              deliveryTime: item.product?.business?.deliveryTime || 'N/A',
              coordinates: item.product?.business?.coordinates || null
            }
          }));
          break;

        case 'errand':
          baseDelivery.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseDelivery.ticketData = order.ticketData;
          break;

        case 'random':
          baseDelivery.deliveryData = order.deliveryData;
          break;
      }

      return baseDelivery;
    });

    res.json({
      success: true,
      count: formattedDeliveries.length,
      data: formattedDeliveries,
      message: `Found ${formattedDeliveries.length} active deliveries`
    });

  } catch (error) {
    console.error('❌ GET ACTIVE DELIVERIES - Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active deliveries',
      error: error.message
    });
  }
};

// [FIXED] Update order status + earnings with proper account updates for all statuses
const updateOrderStatus = async (req, res) => {
  let session = null;
  
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    console.log('STATUS:::', status);
    const riderId = req.user._id;

    console.log(`🔄 Rider ${riderId} updating order ${orderId} to status: ${status}`);

    // Validate input
    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and status are required'
      });
    }

    const validStatuses = ['picked_up', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Start session for potential transaction
    session = await mongoose.startSession();
    
    // For delivered status, use transaction for data consistency
    if (status === 'delivered') {
      await session.withTransaction(async () => {
        // Prepare update data based on status
        const updateData = {
          status,
          $inc: { __v: 1 }
        };

        // Add timestamp based on status
        if (status === 'picked_up') {
          updateData.pickedUpAt = new Date();
        } else if (status === 'delivered') {
          updateData.deliveredAt = new Date();
          console.log('Setting deliveredAt to', updateData.deliveredAt);
        } else if (status === 'cancelled') {
          updateData.cancelledAt = new Date();
        }

        // Atomic update - ensure rider owns the order
        const order = await Order.findOneAndUpdate(
          {
            _id: orderId,
            rider: riderId,
            status: { $in: ['accepted', 'picked_up'] }
          },
          updateData,
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
              select: 'name address phone'
            }
          });

        if (!order) {
          throw new Error('Order not found or unauthorized for status update');
        }

        // Update rider's account for delivered orders
        let account = await Account.findOne({ user: riderId }).session(session);
        if (!account) {
          account = await Account.create([{
            user: riderId,
            status: 'active',
            vehicleType: 'bike'
          }], { session });
          account = account[0];
        }

        // ✅ FIX: Ensure order has acceptedAt before updating performance
        if (!order.acceptedAt) {
          console.warn(`Order ${order._id} missing acceptedAt, setting to current time`);
          order.acceptedAt = new Date();
        }
        
        // Update performance and earnings for delivered orders
        account.updatePerformance(order, 'delivered');
        account.updateEarnings(order);
        account.incrementCompleted();
        await account.calculateRanking();

        // Save account changes
        await account.save({ session });

        // Also update user delivery history
        const user = await User.findById(riderId).session(session);
        if (user) {
          const driverShare = Math.round(
            Number(order.deliveryFee) * 
            (Number(process.env.DRIVER_COMMISSION_RATE) || 0.75) * 100
          ) / 100;

          user.pushDeliveryMeta({
            orderId: order._id,
            orderNumber: order.orderNumber,
            deliveredAt: order.deliveredAt,
            acceptedAt: order.acceptedAt,
            deliveryFee: order.deliveryFee,
            distance: order.distance || 0,
            earnings: driverShare,
          });
          await user.save({ session });
        }

        console.log(`✅ Order ${orderId} status updated to ${status} by rider ${riderId}`);
        
        res.json({
          success: true,
          data: {
            orderNumber: order.orderNumber,
            type: order.type,
            status: order.status,
            acceptedAt: order.acceptedAt,
            pickedUpAt: order.pickedUpAt,
            deliveredAt: order.deliveredAt,
            cancelledAt: order.cancelledAt
          },
          message: `Order status updated to ${status} successfully`
        });
      });
    } else {
      // For non-delivered statuses, use simpler approach without transaction
      const updateData = {
        status,
        $inc: { __v: 1 }
      };

      // Add timestamp based on status
      if (status === 'picked_up') {
        updateData.pickedUpAt = new Date();
      } else if (status === 'cancelled') {
        updateData.cancelledAt = new Date();
      }

      // Update order without transaction
      const order = await Order.findOneAndUpdate(
        {
          _id: orderId,
          rider: riderId,
          status: { $in: ['accepted', 'picked_up'] }
        },
        updateData,
        {
          new: true,
          runValidators: true
        }
      ).populate('user', 'name phone')
       .populate({
          path: 'items.product',
          select: 'name images price featuredImage business',
          populate: {
            path: 'business',
            select: 'name address phone'
          }
        });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found or unauthorized for status update'
        });
      }

      // Update account performance for non-delivered statuses (without transaction)
      let account = await Account.findOne({ user: riderId });
      if (!account) {
        account = await Account.create({
          user: riderId,
          status: 'active',
          vehicleType: 'bike'
        });
      }

      // Update performance based on status
      if (status === 'picked_up') {
        account.updatePerformance(order, 'picked_up');
      } else if (status === 'cancelled') {
        account.updatePerformance(order, 'cancelled');
      }

      await account.save();

      console.log(`✅ Order ${orderId} status updated to ${status} by rider ${riderId}`);

      res.json({
        success: true,
        data: {
          orderNumber: order.orderNumber,
          type: order.type,
          status: order.status,
          acceptedAt: order.acceptedAt,
          pickedUpAt: order.pickedUpAt,
          deliveredAt: order.deliveredAt,
          cancelledAt: order.cancelledAt
        },
        message: `Order status updated to ${status} successfully`
      });
    }

  } catch (error) {
    console.error('❌ UPDATE ORDER STATUS - Error:', error);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    if (error.message === 'Order not found or unauthorized for status update') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update order status',
      error: error.message
    });
  } finally {
    if (session) {
      session.endSession();
    }
  }
};

// ====================
// ADMIN PANEL FUNCTIONS
// ====================

// @desc    Get all orders (for admin panel)
// @route   GET /api/orders
// @access  Private/Admin
const getAllOrders = async (req, res) => {
  try {
    console.log('📦 ADMIN - Fetching all orders...');

    const orders = await Order.find()
      .populate('user', 'name phone email')
      .populate('rider', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name phone address deliveryTime'
        }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt createdBy isAdminCreated paymentStatus paymentMethod distance rejectedBy rejectedAt')
      .sort({ createdAt: -1 });

    console.log(`✅ ADMIN - Found ${orders.length} total orders`);

    // Format orders for frontend
    const formattedOrders = orders.map(order => {
      const baseOrder = {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        // Payment fields
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        distance: order.distance || 0,
        // Customer information
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone,
          email: order.user?.email || 'N/A'
        },
        // Rider information
        rider: order.rider ? {
          name: order.rider.name,
          phone: order.rider.phone
        } : null,
        // Delivery information
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || '',
        // Timestamps
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        rejectedAt: order.rejectedAt,
        // Additional admin info
        createdBy: order.createdBy || 'customer',
        isAdminCreated: order.isAdminCreated || false,
        rejectedBy: order.rejectedBy || null
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseOrder.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: item.product?.business ? {
              name: item.product.business.name || 'Business not found',
              phone: item.product.business.phone || '',
              address: item.product.business.address || '',
              deliveryTime: item.product.business.deliveryTime || 'N/A'
            } : null
          }));
          break;

        case 'errand':
          baseOrder.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;
      }

      return baseOrder;
    });

    res.json({
      success: true,
      count: formattedOrders.length,
      data: formattedOrders,
      message: `Found ${formattedOrders.length} orders`
    });

  } catch (error) {
    console.error('❌ ADMIN - GET ALL ORDERS ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
};

// @desc    Update order (for admin panel)
// @route   PUT /api/orders/:id
// @access  Private/Admin
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`✏️ ADMIN - Updating order ${id}:`, updateData);

    // Validate order exists
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Allowed fields for admin update
    const allowedUpdates = ['status', 'deliveryAddress', 'phone', 'notes', 'rider', 'paymentStatus', 'paymentMethod', 'distance'];
    const updates = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    // Add timestamps based on status changes
    if (updates.status && updates.status !== order.status) {
      const timestampField = {
        'accepted': 'acceptedAt',
        'picked_up': 'pickedUpAt', 
        'delivered': 'deliveredAt',
        'cancelled': 'cancelledAt'
      }[updates.status];
      
      if (timestampField && !order[timestampField]) {
        updates[timestampField] = new Date();
      }
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
    .populate('user', 'name phone email')
    .populate('rider', 'name phone')
    .populate({
      path: 'items.product',
      select: 'name images price featuredImage business',
      populate: {
        path: 'business',
        select: 'name phone'
      }
    });

    console.log(`✅ ADMIN - Order ${id} updated successfully`);

    const responseData = {
      id: updatedOrder._id,
      orderNumber: updatedOrder.orderNumber,
      type: updatedOrder.type,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      paymentMethod: updatedOrder.paymentMethod,
      total: updatedOrder.total,
      subtotal: updatedOrder.subtotal,
      deliveryFee: updatedOrder.deliveryFee,
      distance: updatedOrder.distance,
      customer: {
        name: updatedOrder.user?.name || 'Customer',
        phone: updatedOrder.user?.phone || updatedOrder.phone,
        email: updatedOrder.user?.email
      },
      rider: updatedOrder.rider ? {
        name: updatedOrder.rider.name,
        phone: updatedOrder.rider.phone
      } : null,
      deliveryAddress: updatedOrder.deliveryAddress,
      phone: updatedOrder.phone,
      notes: updatedOrder.notes || '',
      createdAt: updatedOrder.createdAt,
      acceptedAt: updatedOrder.acceptedAt,
      pickedUpAt: updatedOrder.pickedUpAt,
      deliveredAt: updatedOrder.deliveredAt,
      cancelledAt: updatedOrder.cancelledAt
    };

    // Add type-specific items
    if (updatedOrder.type === 'business') {
      responseData.items = updatedOrder.items.map(item => ({
        name: item.product?.name || 'Product not found',
        images: item.product?.images || [],
        featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
        price: item.price,
        quantity: item.quantity,
        business: item.product?.business?.name || 'Business not found'
      }));
    } else if (updatedOrder.type === 'errand') {
      responseData.errandItems = updatedOrder.errandItems;
    } else if (updatedOrder.type === 'ticket') {
      responseData.ticketData = updatedOrder.ticketData;
    } else if (updatedOrder.type === 'random') {
      responseData.deliveryData = updatedOrder.deliveryData;
    }

    res.json({
      success: true,
      data: responseData,
      message: 'Order updated successfully'
    });

  } catch (error) {
    console.error('❌ ADMIN - UPDATE ORDER ERROR:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: error.message
    });
  }
};

// @desc    Delete order (for admin panel)
// @route   DELETE /api/orders/:id
// @access  Private/Admin
const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ ADMIN - Deleting order ${id}`);

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Prevent deletion of orders that are in progress
    if (['accepted', 'picked_up'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete order that is in progress. Cancel it first.'
      });
    }

    await Order.findByIdAndDelete(id);

    console.log(`✅ ADMIN - Order ${id} deleted successfully`);

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('❌ ADMIN - DELETE ORDER ERROR:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete order',
      error: error.message
    });
  }
};


// @desc    Get rider's orders with status filter (admin only)
// @route   GET /api/orders/rider/:riderId
// @access  Private/Admin
const getRiderOrders = async (req, res) => {
  try {
    const { riderId } = req.params;
    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    console.log(`📊 ADMIN - Fetching orders for rider ${riderId} with filters:`, {
      status,
      startDate,
      endDate,
      page,
      limit
    });

    // Validate rider exists and get commission rate
    const rider = await User.findById(riderId).select('name phone email role commission');
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    if (!['rider', 'admin'].includes(rider.role)) {
      return res.status(400).json({
        success: false,
        message: 'User is not a rider'
      });
    }

    // Get commission rate (default to 75% if not set)
    const commissionRate = rider.commission || 0.75;

    // Build query
    const query = { rider: riderId };
    
    // Add status filter if provided
    if (status) {
      if (status === 'all') {
        // Include all orders except pending (since rider can only accept pending orders)
        query.status = { $in: ['accepted', 'picked_up', 'delivered', 'cancelled', 'rejected'] };
      } else if (status === 'active') {
        query.status = { $in: ['accepted', 'picked_up'] };
      } else if (status === 'completed') {
        query.status = 'delivered';
      } else {
        query.status = status;
      }
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name address phone deliveryTime'
        }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Order.countDocuments(query);

    console.log(`✅ ADMIN - Found ${orders.length} orders for rider ${riderId}`);

    // Format orders and calculate earnings with commission
    let totalDeliveryFees = 0;
    let totalRiderEarnings = 0;

    const formattedOrders = orders.map(order => {
      // Calculate rider's earnings for this order (after commission)
      const deliveryFee = order.deliveryFee || 0;
      const riderEarnings = Math.round(deliveryFee * commissionRate * 100) / 100;
      
      // Accumulate totals
      totalDeliveryFees += deliveryFee;
      totalRiderEarnings += riderEarnings;

      const baseOrder = {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: deliveryFee,
        riderEarnings: riderEarnings, // Add rider's actual earnings to each order
        commissionRate: commissionRate, // Include commission rate in response
        subtotal: order.subtotal,
        // Payment info
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        distance: order.distance || 0,
        // Customer info
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone
        },
        // Delivery info
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || '',
        // Timestamps
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        rejectedAt: order.rejectedAt
      };

      // Add type-specific items
      switch (order.type) {
        case 'business':
          baseOrder.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: item.product?.business ? {
              name: item.product.business.name || 'Business not found',
              phone: item.product.business.phone || '',
              address: item.product.business.address || '',
              deliveryTime: item.product.business.deliveryTime || 'N/A'
            } : null
          }));
          break;

        case 'errand':
          baseOrder.errandItems = order.errandItems;
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;
      }

      return baseOrder;
    });

    // Calculate rider statistics with commission
    const completedOrdersCount = await Order.countDocuments({ 
      rider: riderId, 
      status: 'delivered' 
    });

    const activeOrdersCount = await Order.countDocuments({ 
      rider: riderId, 
      status: { $in: ['accepted', 'picked_up'] } 
    });

    const cancelledOrdersCount = await Order.countDocuments({ 
      rider: riderId, 
      status: 'cancelled' 
    });

    const totalOrdersCount = await Order.countDocuments({ rider: riderId });

    // Calculate total earnings using aggregation for accuracy
    const earningsResult = await Order.aggregate([
      { 
        $match: { 
          rider: new mongoose.Types.ObjectId(riderId),
          status: 'delivered'
        } 
      },
      {
        $group: {
          _id: null,
          totalDeliveryFees: { $sum: '$deliveryFee' },
          orderCount: { $sum: 1 }
        }
      }
    ]);

    const aggregatedTotalDeliveryFees = earningsResult[0]?.totalDeliveryFees || 0;
    const calculatedTotalEarnings = Math.round(aggregatedTotalDeliveryFees * commissionRate * 100) / 100;

    const stats = {
      totalOrders: totalOrdersCount,
      completedOrders: completedOrdersCount,
      activeOrders: activeOrdersCount,
      cancelledOrders: cancelledOrdersCount,
      totalDeliveryFees: aggregatedTotalDeliveryFees, // Total delivery fees before commission
      totalEarnings: calculatedTotalEarnings, // Rider's actual earnings after commission
      commissionRate: commissionRate, // Rider's commission rate
      platformShare: Math.round(aggregatedTotalDeliveryFees * (1 - commissionRate) * 100) / 100 // Platform's share
    };

    res.json({
      success: true,
      data: {
        rider: {
          id: rider._id,
          name: rider.name,
          phone: rider.phone,
          email: rider.email,
          role: rider.role,
          commission: commissionRate // Include commission in rider info
        },
        orders: formattedOrders,
        statistics: stats,
        pagination: {
          current: pageNum,
          pages: Math.ceil(total / limitNum),
          total,
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1
        }
      },
      message: `Found ${formattedOrders.length} orders for rider ${rider.name}`
    });

  } catch (error) {
    console.error('❌ ADMIN - GET RIDER ORDERS ERROR:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid rider ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rider orders',
      error: error.message
    });
  }
};


// @desc    Get orders by business ID (FINAL FIXED VERSION)
// @route   GET /api/orders/business/:businessId
// @access  Private/BusinessOwner/Admin
const getOrdersByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { 
      status, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 20
    } = req.query;

    console.log(`🏪 Fetching orders for business ${businessId}`);

    // Validate business exists
    const business = await Business.findById(businessId).select('name phone address owner');
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Check if user has permission
    const isBusinessOwner = business.owner && business.owner.toString() === req.user._id.toString();
    const isAuthorized = req.user.role === 'admin' || 'vendor';
    
    if (!isBusinessOwner && !isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized to view orders for this business.'
      });
    }

    // Build query to find business-type orders
    const query = { 
      type: 'business' // Only get business-type orders
    };

    // Add status filter if provided
    if (status && status !== 'all') {
      query.status = status;
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get ALL business-type orders first
    const orders = await Order.find(query)
      .populate('user', 'name phone email')
      .populate('rider', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage category business',
        populate: {
          path: 'business',
          select: 'name phone address deliveryTime'
        }
      })
      .select('orderNumber type status total deliveryFee subtotal items deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt paymentStatus paymentMethod')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    console.log(`📊 Found ${orders.length} business-type orders`);

    // Filter orders to only include those with items from this specific business
    const filteredOrders = orders.map(order => {
      // Filter items to only include products that belong to this business
      const businessItems = order.items.filter(item => {
        if (!item.product || !item.product.business) return false;
        
        const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
        return itemBusinessId === businessId;
      });

      // If no items from this business, return null (will be filtered out)
      if (businessItems.length === 0) {
        return null;
      }

      console.log(`🛒 Order ${order.orderNumber}: ${businessItems.length} items from ${business.name}`);

      // Calculate business-specific totals
      const businessSubtotal = businessItems.reduce((sum, item) => 
        sum + (item.price * item.quantity), 0
      );

      // Calculate proportional delivery fee
      const totalOrderValue = order.items.reduce((sum, item) => 
        sum + (item.price * item.quantity), 0
      );
      
      const businessDeliveryFee = totalOrderValue > 0 
        ? Math.round((businessSubtotal / totalOrderValue) * order.deliveryFee)
        : 0;

      const businessTotal = businessSubtotal + businessDeliveryFee;

      return {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        distance: order.distance,
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone,
          email: order.user?.email
        },
        rider: order.rider ? {
          name: order.rider.name,
          phone: order.rider.phone
        } : null,
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes,
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        createdBy: order.createdBy || 'customer',
        isAdminCreated: order.isAdminCreated || false,
        rejectedBy: order.rejectedBy,
        // Business-specific data
        items: businessItems.map(item => ({
          name: item.product.name,
          images: item.product.images || [],
          featuredImage: item.product.featuredImage || (item.product.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          business: {
            name: item.product.business.name,
            phone: item.product.business.phone,
            address: item.product.business.address,
            deliveryTime: item.product.business.deliveryTime
          }
        })),
        businessSubtotal,
        businessDeliveryFee,
        businessTotal,
        itemCount: businessItems.length
      };
    }).filter(order => order !== null); // Remove orders that don't have items from this business

    // Get total count for pagination (need to do this differently)
    const allBusinessOrders = await Order.find({ type: 'business' })
      .populate({
        path: 'items.product',
        select: 'business',
        populate: {
          path: 'business',
          select: '_id'
        }
      })
      .lean();

    const total = allBusinessOrders.filter(order => 
      order.items.some(item => {
        if (!item.product || !item.product.business) return false;
        const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
        return itemBusinessId === businessId;
      })
    ).length;

    // Calculate business statistics
    const stats = {
      totalOrders: filteredOrders.length,
      pendingOrders: 0,
      acceptedOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      totalOrdersRevenue: 0
    };

    filteredOrders.forEach(order => {
      // Count by status
      if (order.status === 'pending') stats.pendingOrders++;
      if (order.status === 'accepted') stats.acceptedOrders++;
      if (order.status === 'delivered') stats.deliveredOrders++;
      if (order.status === 'cancelled') stats.cancelledOrders++;

      // Calculate revenue from delivered orders
      if (order.status === 'delivered') {
        stats.totalRevenue += order.businessSubtotal;
      }
    });

    // Calculate averages
    stats.averageOrderValue = stats.deliveredOrders > 0 
      ? Math.round(stats.totalRevenue / stats.deliveredOrders) 
      : 0;
    stats.totalOrdersRevenue = stats.totalOrders;

    console.log(`✅ SUCCESS: Found ${filteredOrders.length} orders for business ${business.name}`);

    res.json({
      success: true,
      data: {
        business: {
          id: business._id,
          name: business.name,
          phone: business.phone,
          address: business.address
        },
        orders: filteredOrders,
        statistics: stats,
        pagination: {
          current: pageNum,
          pages: Math.ceil(total / limitNum),
          total,
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1
        }
      },
      message: `Found ${filteredOrders.length} orders for ${business.name}`
    });

  } catch (error) {
    console.error('❌ GET ORDERS BY BUSINESS - Error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid business ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch business orders',
      error: error.message
    });
  }
};

// @desc    Get business order statistics (FIXED VERSION)
// @route   GET /api/orders/business/:businessId/stats
// @access  Private/BusinessOwner/Admin
const getBusinessOrderStats = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { period = 'month' } = req.query;

    console.log(`📊 Fetching order stats for business ${businessId} for period: ${period}`);

    // Validate business exists
    const business = await Business.findById(businessId).select('name owner');
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Check permission
    const isBusinessOwner = business.owner && business.owner.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (!isBusinessOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized to view stats for this business.'
      });
    }

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(now.getMonth() - 1);
    }

    console.log(`📅 Date range: ${startDate} to ${now}`);

    // Get all business orders within date range
    const allOrders = await Order.find({ 
      type: 'business',
      createdAt: { $gte: startDate }
    })
    .populate({
      path: 'items.product',
      select: 'name business',
      populate: {
        path: 'business',
        select: 'name _id'
      }
    })
    .lean();

    console.log(`📦 Found ${allOrders.length} total business orders in date range`);

    // Filter orders to only include those with items from this business
    const businessOrders = allOrders.filter(order => 
      order.items.some(item => {
        if (!item.product || !item.product.business) return false;
        const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
        return itemBusinessId === businessId;
      })
    );

    console.log(`✅ Found ${businessOrders.length} orders for ${business.name}`);

    // Calculate status breakdown
    const statusBreakdown = {
      pending: 0,
      accepted: 0,
      picked_up: 0,
      delivered: 0,
      cancelled: 0
    };

    let totalRevenue = 0;
    let deliveredCount = 0;
    let cancelledCount = 0;

    businessOrders.forEach(order => {
      // Count by status
      statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;

      // Calculate revenue from delivered orders
      if (order.status === 'delivered') {
        deliveredCount++;
        // Calculate business-specific revenue for this order
        const businessItems = order.items.filter(item => {
          if (!item.product || !item.product.business) return false;
          const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
          return itemBusinessId === businessId;
        });

        const businessRevenue = businessItems.reduce((sum, item) => 
          sum + (item.price * item.quantity), 0
        );
        
        totalRevenue += businessRevenue;
      }

      if (order.status === 'cancelled') {
        cancelledCount++;
      }
    });

    const totalOrders = businessOrders.length;
    const completionRate = totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0;
    const cancellationRate = totalOrders > 0 ? Math.round((cancelledCount / totalOrders) * 100) : 0;

    // Get daily trends
    const dailyTrends = [];
    const dailyRevenue = {};

    businessOrders.forEach(order => {
      if (order.status === 'delivered') {
        const dateStr = order.createdAt.toISOString().split('T')[0];
        
        // Calculate business-specific revenue for this order
        const businessItems = order.items.filter(item => {
          if (!item.product || !item.product.business) return false;
          const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
          return itemBusinessId === businessId;
        });

        const businessRevenue = businessItems.reduce((sum, item) => 
          sum + (item.price * item.quantity), 0
        );

        if (!dailyRevenue[dateStr]) {
          dailyRevenue[dateStr] = { orders: 0, revenue: 0 };
        }
        dailyRevenue[dateStr].orders += 1;
        dailyRevenue[dateStr].revenue += businessRevenue;
      }
    });

    // Convert daily revenue to array format
    Object.keys(dailyRevenue).forEach(date => {
      dailyTrends.push({
        _id: date,
        orders: dailyRevenue[date].orders,
        revenue: dailyRevenue[date].revenue
      });
    });

    // Sort daily trends by date
    dailyTrends.sort((a, b) => a._id.localeCompare(b._id));

    // Get popular products
    const productSales = {};

    businessOrders.forEach(order => {
      if (order.status === 'delivered') {
        order.items.forEach(item => {
          if (item.product && item.product.business) {
            const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
            if (itemBusinessId === businessId) {
              const productId = item.product._id.toString();
              if (!productSales[productId]) {
                productSales[productId] = {
                  productName: item.product.name,
                  totalSold: 0,
                  totalRevenue: 0
                };
              }
              productSales[productId].totalSold += item.quantity;
              productSales[productId].totalRevenue += (item.price * item.quantity);
            }
          }
        });
      }
    });

    // Convert to array and sort by total sold
    const popularProducts = Object.values(productSales)
      .sort((a, b) => b.totalSold - a.totalSold)
      .slice(0, 10);

    const response = {
      business: {
        id: business._id,
        name: business.name
      },
      period: {
        type: period,
        startDate: startDate,
        endDate: now
      },
      overview: {
        totalOrders: totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        completionRate: completionRate,
        cancellationRate: cancellationRate
      },
      statusBreakdown: statusBreakdown,
      dailyTrends: dailyTrends,
      popularProducts: popularProducts
    };

    console.log(`✅ Business stats retrieved for ${business.name}:`, {
      totalOrders,
      totalRevenue,
      completionRate,
      dailyTrends: dailyTrends.length,
      popularProducts: popularProducts.length
    });

    res.json({
      success: true,
      data: response,
      message: `Business statistics retrieved for ${period} period`
    });

  } catch (error) {
    console.error('❌ GET BUSINESS ORDER STATS - Error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid business ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch business statistics',
      error: error.message
    });
  }
};

/**
 * @desc    Confirm an order after successful payment
 * @route   PATCH /api/orders/order-number/:orderNumber/confirm
 * @access  Private (order owner)
 */
const confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      orderNumber,
      user: userId,
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Order not found or not authorized',
      });
    }

    // Prevent re‑confirming an already confirmed order
    if (order.status === 'confirmed') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order is already confirmed',
      });
    }

    // Only allow confirmation for orders that are still pending
    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot confirm order with status "${order.status}"`,
      });
    }

    order.status = 'confirmed';
    order.paymentStatus = 'paid';
    order.paymentMethod = 'momo';
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
      },
      message: 'Order confirmed successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Confirm order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm order',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  deleteMyOrder,
  getPendingOrders,
  getMyCompletedDeliveries,
  acceptDelivery,
  rejectDelivery,
  getMyActiveDeliveries,
  updateOrderStatus,
  // NEW ADMIN FUNCTIONS
  getAllOrders,
  updateOrder,
  deleteOrder,
  createOrderForUser,
  getRiderOrders,
  // NEW BUSINESS FUNCTIONS
  getOrdersByBusiness,
  getBusinessOrderStats,
  confirmOrder
};