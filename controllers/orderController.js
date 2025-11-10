/**
 * controllers/orderController.js
 * Full delivery/order logic with all route handlers including errands, tickets, random delivery.
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const Account = require("../models/Account");
const User = require("../models/User");
const twilio = require("twilio");
const Store = require("../models/Store");
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
const validateTicketBooking = (ticketData) => {
  const { busAgency, seatNumber, idCard, departureTime, destination } = ticketData;
  
  if (!busAgency) {
    throw new Error("Bus agency is required for ticket booking");
  }
  if (!seatNumber) {
    throw new Error("Seat number is required for ticket booking");
  }
  if (!idCard) {
    throw new Error("ID card is required for ticket booking");
  }
  if (!departureTime) {
    throw new Error("Departure time is required for ticket booking");
  }
  if (!destination) {
    throw new Error("Destination is required for ticket booking");
  }

  return {
    busAgency,
    seatNumber,
    idCard,
    departureTime: new Date(departureTime),
    destination,
    price: ticketData.price || 0
  };
};

// Validate random delivery
const validateRandomDelivery = (deliveryData) => {
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

// Validate business order (existing product-based order)
const validateBusinessOrder = async (items) => {
  if (!items || items.length === 0) {
    throw new Error("No items in order");
  }

  let subtotal = 0;
  const orderItems = [];
  const storeDeliveryFees = new Map();
  const storeIds = new Set();

  for (const item of items) {
    const product = await Product.findById(item.product).populate("store");

    if (!product) {
      throw new Error(`Product not found: ${item.product}`);
    }

    if (!product.inStock) {
      throw new Error(`${product.name} is out of stock`);
    }

    const price = product.discount > 0
      ? product.price * (1 - product.discount / 100)
      : product.price;

    const itemTotal = price * item.quantity;
    subtotal += itemTotal;

    const storeId = product.store._id.toString();
    storeIds.add(storeId);

    if (!storeDeliveryFees.has(storeId)) {
      storeDeliveryFees.set(storeId, product.store.deliveryFee);
    }

    orderItems.push({
      product: product._id,
      store: product.store._id,
      quantity: item.quantity,
      price: price,
    });
  }

  // Calculate delivery fee
  const totalStoreDeliveryFees = Array.from(
    storeDeliveryFees.values()
  ).reduce((sum, fee) => sum + fee, 0);
  const deliveryFee = Math.round(totalStoreDeliveryFees);
  const total = subtotal + deliveryFee;

  return {
    orderItems,
    subtotal,
    deliveryFee,
    total,
    storeIds: Array.from(storeIds)
  };
};

// ================================
// WHATSAPP TEMPLATE FUNCTIONALITY
// ================================

// Template 1: Order Notification (5 variables - PRIVACY COMPLIANT)
const sendWhatsAppTemplate = async (order, storeIds) => {
  if (!twilioClient || !process.env.WHATSAPP_TEMPLATE_SID) {
    console.log("⚠️ WhatsApp templates not configured");
    return { success: false, message: "WhatsApp templates not configured" };
  }

  try {
    console.log("📱 Sending WhatsApp template notifications...");

    const stores = await Store.find({ _id: { $in: storeIds } }).select(
      "name phone whatsappNumber"
    );
    let sentCount = 0;

    for (const store of stores) {
      const storePhone = store.whatsappNumber || store.phone;
      if (!storePhone) {
        console.log(`❌ No phone number for ${store.name}`);
        continue;
      }

      const storeItems = order.items.filter(
        (item) =>
          item.store &&
          item.store._id &&
          item.store._id.toString() === store._id.toString()
      );

      if (storeItems.length === 0) {
        console.log(`❌ No items for ${store.name}`);
        continue;
      }

      // Format items list
      const itemsList = storeItems
        .map((item) => `${item.quantity}x ${item.product.name}`)
        .join(", ");

      const storeSubtotal = storeItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // Template variables (NO CUSTOMER PHONE - Privacy compliant)
      const contentVariables = {
        1: order.orderNumber, // Order number
        2: order.user?.name || "Customer", // Customer name (no phone)
        3: itemsList, // Items list
        4: formatPrice(storeSubtotal), // Total amount
        5: order.deliveryAddress, // Delivery address
      };

      try {
        let formattedPhone = storePhone.replace(/\D/g, "");
        if (!formattedPhone.startsWith("237") && formattedPhone.length === 9) {
          formattedPhone = "237" + formattedPhone;
        }

        const result = await twilioClient.messages.create({
          contentSid: process.env.WHATSAPP_TEMPLATE_SID,
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: `whatsapp:+${formattedPhone}`,
          contentVariables: JSON.stringify(contentVariables),
        });

        console.log(`✅ Template sent to ${store.name}`);
        console.log(`   📞 ${storePhone} | Status: ${result.status}`);
        sentCount++;
      } catch (twilioError) {
        console.error(
          `❌ Failed to send template to ${store.name}:`,
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
      totalStores: stores.length,
      message: `WhatsApp templates sent to ${sentCount}/${stores.length} stores`,
    };
  } catch (error) {
    console.error("🚨 WhatsApp template error:", error);
    return { success: false, error: error.message };
  }
};

// WhatsApp URL fallback (when templates fail)
const generateWhatsAppURLs = async (order, storeIds) => {
  console.log("\n🔗 ========== WHATSAPP URL NOTIFICATIONS ==========");
  console.log("📱 PRIVACY: Customer phone numbers excluded");
  console.log("💡 INSTRUCTIONS: Click URLs to send manually");
  console.log("====================================================\n");

  const stores = await Store.find({ _id: { $in: storeIds } }).select(
    "name phone whatsappNumber"
  );
  let urlCount = 0;

  stores.forEach((store, index) => {
    const storePhone = store.whatsappNumber || store.phone;
    if (!storePhone) {
      console.log(`❌ ${index + 1}. ${store.name}: No phone number`);
      return;
    }

    const storeItems = order.items.filter(
      (item) =>
        item.store &&
        item.store._id &&
        item.store._id.toString() === store._id.toString()
    );

    if (storeItems.length === 0) {
      console.log(`❌ ${index + 1}. ${store.name}: No items`);
      return;
    }

    // Format items with prices
    const itemsList = storeItems
      .map(
        (item) =>
          `${item.quantity}x ${item.product.name} - ${formatPrice(
            item.price * item.quantity
          )}`
      )
      .join("%0A");

    const storeSubtotal = storeItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Message WITHOUT customer phone (Privacy compliant)
    const message =
      `NEW ORDER RECEIVED%0A%0A` +
      `Order Number: ${order.orderNumber}%0A` +
      `Customer Name: ${order.user?.name || "Customer"}%0A%0A` +
      `YOUR ITEMS:%0A${itemsList}%0A%0A` +
      `Store Subtotal: ${formatPrice(storeSubtotal)}%0A%0A` +
      `Delivery Address: ${order.deliveryAddress}%0A%0A` +
      `Order Notes: ${order.notes || "No special instructions"}%0A%0A` +
      `Please confirm receipt and preparation time.`;

    const formattedPhone = storePhone.replace(/\D/g, "");
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${message}`;

    console.log(`✅ ${index + 1}. ${store.name}`);
    console.log(`   📞 Store: ${storePhone}`);
    console.log(
      `   👤 Customer: ${order.user?.name || "Customer"} (phone protected)`
    );
    console.log(
      `   📦 ${storeItems.length} item(s) - ${formatPrice(storeSubtotal)}`
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
const sendStoreNotifications = async (order, storeIds) => {
  console.log("\n🎯 ========== STORE NOTIFICATIONS ==========");

  // Try templates first
  const templateResult = await sendWhatsAppTemplate(order, storeIds);

  if (!templateResult.success || templateResult.sentCount === 0) {
    console.log("🔄 Falling back to WhatsApp URLs...");
    const urlCount = await generateWhatsAppURLs(order, storeIds);
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
        // Notify stores about their products
        const storeIds = [...new Set(order.items.map(item => item.store?.toString()).filter(Boolean))];
        if (storeIds.length > 0) {
          notificationResult = await sendStoreNotifications(order, storeIds);
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
      type = 'business', // Default to business for backward compatibility
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

    if (!req.user) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Validate required fields
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

    let storeIds = [];
    let calculatedTotal = 0;
    let calculatedSubtotal = 0;
    let calculatedDeliveryFee = 0;

    // Process based on order type
    switch (type) {
      case 'business':
        const businessResult = await validateBusinessOrder(items);
        orderData.items = businessResult.orderItems;
        orderData.subtotal = businessResult.subtotal;
        orderData.deliveryFee = businessResult.deliveryFee;
        orderData.total = businessResult.total;
        storeIds = businessResult.storeIds;
        break;

      case 'errand':
        const validatedErrandItems = validateErrandItems(errandItems);
        orderData.errandItems = validatedErrandItems;
        
        // Calculate errand totals
        calculatedSubtotal = validatedErrandItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        calculatedDeliveryFee = 1000; // Base delivery fee for errands
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
        
        // Calculate ticket totals
        calculatedSubtotal = ticketData.price || 5000; // Default ticket price
        calculatedDeliveryFee = 1000; // Delivery fee for ticket
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;

      case 'random':
        const deliveryData = validateRandomDelivery({
          pickupAddress: pickupAddress || deliveryAddress, // Use pickupAddress if provided, else use deliveryAddress
          deliveryAddress: randomDeliveryAddress || deliveryAddress,
          senderNumber,
          receiverNumber,
          itemDescription,
          price: deliveryPrice
        });
        orderData.deliveryData = deliveryData;
        
        // Calculate delivery totals
        calculatedSubtotal = deliveryData.price || 2000; // Base delivery price
        calculatedDeliveryFee = 1000; // Service fee
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
    await createdOrder.populate('user', 'name phone');
    
    if (type === 'business') {
      await createdOrder.populate({
        path: "items.product",
        select: "name images price featuredImage"
      });

      await createdOrder.populate({
        path: "items.store",
        select: "name deliveryTime"
      });
    }

    // Send notifications (non-blocking)
    const notificationResult = await sendOrderNotifications(createdOrder);

    await session.commitTransaction();

    // Format response based on order type
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

    // Add type-specific data to response
    switch (type) {
      case 'business':
        responseData.items = createdOrder.items.map((item) => ({
          name: item.product.name,
          images: item.product.images || [],
          featuredImage: item.product.featuredImage || (item.product.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          store: item.store.name,
          deliveryTime: item.store.deliveryTime,
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
    console.error("Order creation error:", error);

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

// @desc    Create order for user (admin only) - UPDATED FOR ALL TYPES
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

    let storeIds = [];
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
        storeIds = businessResult.storeIds;
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
      await createdOrder.populate({
        path: "items.product",
        select: "name images price featuredImage"
      });

      await createdOrder.populate({
        path: "items.store",
        select: "name deliveryTime phone address"
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
          store: item.store.name,
          deliveryTime: item.store.deliveryTime,
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

// ================================
// ORDER RETRIEVAL - ALL TYPES
// ================================

// Get user orders (all types)
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage'
      })
      .populate({
        path: 'items.store',
        select: 'name deliveryTime'
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt deliveredAt')
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map(order => {
      const baseOrder = {
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
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
            store: item.store?.name || 'Store not found',
            deliveryTime: item.store?.deliveryTime || 'N/A'
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

// Get single order with all type data
const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("rider", "name phone")
      .populate("user", "name phone")
      .populate("items.product", "name images price featuredImage")
      .populate("items.store", "name address phone");
      
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
          featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || '')
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

// ================================
// EXISTING FUNCTIONS (UNCHANGED)
// ================================

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
        select: 'name images price category featuredImage'
      })
      .populate({
        path: 'items.store',
        select: 'name phone address deliveryTime coordinates'
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
            store: {
              name: item.store?.name || 'Store not found',
              phone: item.store?.phone || '',
              address: item.store?.address || '',
              deliveryTime: item.store?.deliveryTime || 'N/A',
              coordinates: item.store?.coordinates || null
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
          break;
      }

      return baseOrder;
    });

    res.json({
      success: true,
      count: formattedOrders.length,
      data: formattedOrders,
      message: `Found ${formattedOrders.length} pending orders`
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
    .populate('items.product', 'name images price featuredImage')
    .populate('items.store', 'name address deliveryTime coordinates phone')
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
            store: {
              name: item.store?.name || 'Store not found',
              phone: item.store?.phone || '',
              address: item.store?.address || '',
              deliveryTime: item.store?.deliveryTime || 'N/A',
              coordinates: item.store?.coordinates || null
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
     .populate('items.product', 'name images price featuredImage')
     .populate('items.store', 'name address deliveryTime coordinates phone');

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
          store: {
            name: item.store?.name || 'Store not found',
            address: item.store?.address || '',
            phone: item.store?.phone || '',
            deliveryTime: item.store?.deliveryTime || 'N/A',
            coordinates: item.store?.coordinates || null
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
    .populate('items.product', 'name images price featuredImage')
    .populate('items.store', 'name address deliveryTime coordinates phone')
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
            store: {
              name: item.store?.name || 'Store not found',
              phone: item.store?.phone || '',
              address: item.store?.address || '',
              deliveryTime: item.store?.deliveryTime || 'N/A',
              coordinates: item.store?.coordinates || null
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
         .populate('items.product', 'name images price featuredImage')
         .populate('items.store', 'name address phone');

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
       .populate('items.product', 'name images price featuredImage')
       .populate('items.store', 'name address phone');

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
      .populate('items.product', 'name images price featuredImage')
      .populate('items.store', 'name phone address deliveryTime')
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt createdBy isAdminCreated')
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
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone,
          email: order.user?.email || 'N/A'
        },
        rider: order.rider ? {
          name: order.rider.name,
          phone: order.rider.phone
        } : null,
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || '',
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        // Additional admin info
        createdBy: order.createdBy || 'customer',
        isAdminCreated: order.isAdminCreated || false
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
            store: item.store ? {
              name: item.store.name || 'Store not found',
              phone: item.store.phone || '',
              address: item.store.address || '',
              deliveryTime: item.store.deliveryTime || 'N/A'
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
    .populate('items.product', 'name images price featuredImage')
    .populate('items.store', 'name phone');

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
        store: item.store?.name || 'Store not found'
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

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
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
  createOrderForUser
};