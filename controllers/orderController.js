/**
 * controllers/orderController.js
 * Full delivery/order logic with all route handlers.
 * Updated: all financial totals are now calculated server‑side.
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

// Validate errand items (legacy)
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
  if (!data.busAgency || !data.seatNumber || !data.passengerName || !data.departureTime || !data.destination || !data.departureCity) {
    throw new Error('Missing required ticket booking fields: busAgency, seatNumber, passengerName, departureTime, destination, departureCity');
  }

  return {
    busAgency: data.busAgency,
    seatNumber: data.seatNumber,
    passengerName: data.passengerName,
    departureTime: data.departureTime,
    destination: data.destination,
    departureCity: data.departureCity,
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

// Validate business order
const validateBusinessOrder = async (items) => {
  if (!items || items.length === 0) {
    throw new Error("No items in order");
  }

  let subtotal = 0;
  const orderItems = [];
  const businessDeliveryFees = new Map();
  const businessIds = new Set();

  for (const item of items) {
    const product = await Product.findById(item.product).populate("business");

    if (!product) {
      throw new Error(`Product not found: ${item.product}`);
    }

    if (!product.inStock) {
      throw new Error(`${product.name} is out of stock`);
    }

    if (!product.business) {
      throw new Error(`Product ${product.name} is not associated with any business`);
    }

    const price = product.discount > 0
      ? product.price * (1 - product.discount / 100)
      : product.price;

    const itemTotal = price * item.quantity;
    subtotal += itemTotal;

    const businessId = product.business._id.toString();
    businessIds.add(businessId);

    if (!businessDeliveryFees.has(businessId)) {
      businessDeliveryFees.set(businessId, product.business.deliveryFee || 1000);
    }

    orderItems.push({
      product: product._id,
      business: product.business._id,
      quantity: item.quantity,
      price: price,
    });
  }

  const totalBusinessDeliveryFees = Array.from(businessDeliveryFees.values()).reduce((sum, fee) => sum + fee, 0);
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

/**
 * Validate bulk order data
 */
const validateBulkOrder = (bulkData) => {
  if (!bulkData) {
    throw new Error('Bulk data is required');
  }

  const { type, parcels, scheduledDate, scheduledTime } = bulkData;

  if (!type || !['pickup', 'delivery'].includes(type)) {
    throw new Error('Bulk type must be either "pickup" or "delivery"');
  }

  if (!scheduledDate) {
    throw new Error('Scheduled date is required');
  }
  if (!scheduledTime) {
    throw new Error('Scheduled time is required');
  }

  if (!parcels || !Array.isArray(parcels) || parcels.length < 2) {
    throw new Error('At least 2 parcels are required for bulk service');
  }

  parcels.forEach((parcel, index) => {
    if (!parcel.description || parcel.description.trim() === '') {
      throw new Error(`Parcel ${index + 1}: description is required`);
    }

    if (type === 'pickup') {
      if (!parcel.pickupAddress || parcel.pickupAddress.trim() === '') {
        throw new Error(`Parcel ${index + 1}: pickup address is required`);
      }
      if (!parcel.pickupContactName || parcel.pickupContactName.trim() === '') {
        throw new Error(`Parcel ${index + 1}: sender name is required`);
      }
      if (!parcel.pickupContactPhone || parcel.pickupContactPhone.trim() === '') {
        throw new Error(`Parcel ${index + 1}: sender phone is required`);
      }
    } else {
      if (!parcel.deliveryAddress || parcel.deliveryAddress.trim() === '') {
        throw new Error(`Parcel ${index + 1}: delivery address is required`);
      }
      if (!parcel.receiverName || parcel.receiverName.trim() === '') {
        throw new Error(`Parcel ${index + 1}: receiver name is required`);
      }
      if (!parcel.receiverPhone || parcel.receiverPhone.trim() === '') {
        throw new Error(`Parcel ${index + 1}: receiver phone is required`);
      }
    }
  });

  if (type === 'pickup') {
    if (!bulkData.receiverName || bulkData.receiverName.trim() === '') {
      throw new Error('Receiver name is required for bulk pickup');
    }
    if (!bulkData.receiverPhone || bulkData.receiverPhone.trim() === '') {
      throw new Error('Receiver phone is required for bulk pickup');
    }
    if (!bulkData.receiverAddress || bulkData.receiverAddress.trim() === '') {
      throw new Error('Receiver address is required for bulk pickup');
    }
  } else {
    if (!bulkData.pickupContactName || bulkData.pickupContactName.trim() === '') {
      throw new Error('Pickup contact name is required for bulk delivery');
    }
    if (!bulkData.pickupContactPhone || bulkData.pickupContactPhone.trim() === '') {
      throw new Error('Pickup contact phone is required for bulk delivery');
    }
    if (!bulkData.pickupAddress || bulkData.pickupAddress.trim() === '') {
      throw new Error('Pickup address is required for bulk delivery');
    }
  }

  return {
    type,
    parcels: parcels.map(p => ({
      description: p.description.trim(),
      ...(type === 'pickup'
        ? {
            pickupAddress: p.pickupAddress.trim(),
            pickupContactName: p.pickupContactName.trim(),
            pickupContactPhone: p.pickupContactPhone.trim(),
          }
        : {
            deliveryAddress: p.deliveryAddress.trim(),
            receiverName: p.receiverName.trim(),
            receiverPhone: p.receiverPhone.trim(),
          })
    })),
    scheduledDate,
    scheduledTime,
    receiverName: type === 'pickup' ? bulkData.receiverName.trim() : undefined,
    receiverPhone: type === 'pickup' ? bulkData.receiverPhone.trim() : undefined,
    receiverAddress: type === 'pickup' ? bulkData.receiverAddress.trim() : undefined,
    pickupContactName: type === 'delivery' ? bulkData.pickupContactName.trim() : undefined,
    pickupContactPhone: type === 'delivery' ? bulkData.pickupContactPhone.trim() : undefined,
    pickupAddress: type === 'delivery' ? bulkData.pickupAddress.trim() : undefined,
  };
};

// ================================
// WHATSAPP TEMPLATE FUNCTIONALITY
// ================================

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

      const itemsList = businessItems
        .map((item) => `${item.quantity}x ${item.product.name}`)
        .join(", ");

      const businessSubtotal = businessItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      const contentVariables = {
        1: order.orderNumber,
        2: order.user?.name || "Customer",
        3: itemsList,
        4: formatPrice(businessSubtotal),
        5: order.deliveryAddress,
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

const sendStoreNotifications = async (order, businessIds) => {
  console.log("\n🎯 ========== BUSINESS NOTIFICATIONS ==========");

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

const sendOrderNotifications = async (order) => {
  try {
    console.log(`📱 Sending notifications for ${order.type} order ${order.orderNumber}`);

    let notificationResult = { method: 'none', count: 0, message: 'No notifications sent' };

    switch (order.type) {
      case 'business':
        const businessIds = [...new Set(order.items.map(item => item.business?.toString()).filter(Boolean))];
        if (businessIds.length > 0) {
          notificationResult = await sendStoreNotifications(order, businessIds);
        }
        break;

      case 'errand':
        const errandMessage = `
NEW ERRAND REQUEST
Order: ${order.orderNumber}
Customer: ${order.user?.name || 'Customer'}
Items: ${order.errandItems?.map(item => `${item.quantity}x ${item.name} - ${formatPrice(item.price)}`).join(', ') || 'Structured data (see order)'}
Total: ${formatPrice(order.total)}
Delivery: ${order.deliveryAddress}
Phone: ${order.phone}
        `.trim();
        console.log('📋 Errand Details:', errandMessage);
        notificationResult = { method: 'errand', count: 1, message: 'Errand notifications sent to admin' };
        break;

      case 'ticket':
        const ticketMessage = `
NEW TICKET BOOKING
Order: ${order.orderNumber}
Agency: ${order.ticketData.busAgency}
Destination: ${order.ticketData.destination}
Seat: ${order.ticketData.seatNumber}
Departure: ${order.ticketData.departureTime}
Customer: ${order.user?.name || 'Customer'}
Phone: ${order.phone}
        `.trim();
        console.log('🎟️ Ticket Details:', ticketMessage);
        notificationResult = { method: 'ticket', count: 1, message: 'Ticket notifications sent to agency' };
        break;

      case 'random':
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
// ORDER CREATION - ALL TYPES (UPDATED)
// ================================

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
      // Legacy errand
      errandItems,
      // New structured errand fields
      errandType,
      shoppingErrand,
      billErrand,
      documentErrand,
      // Ticket fields
      busAgency, seatNumber, idCard, departureTime, travelTimeOfDay,
      destination, ticketPrice, departureCity,
      // Random delivery fields
      pickupAddress, deliveryAddress: randomDeliveryAddress, senderNumber, receiverNumber, itemDescription, deliveryPrice,
      // Bulk data
      bulkData
    } = req.body;

    console.log('📥 Incoming createOrder request body:', JSON.stringify(req.body, null, 2));

    if (!req.user) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    if (!['business', 'errand', 'ticket', 'random', 'bulk'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Valid order type is required (business, errand, ticket, random, bulk)"
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

    switch (type) {
      case 'business':
        const businessResult = await validateBusinessOrder(items);
        orderData.items = businessResult.orderItems;
        orderData.subtotal = businessResult.subtotal;
        orderData.deliveryFee = businessResult.deliveryFee;
        orderData.total = businessResult.total;
        businessIds = businessResult.businessIds;
        break;

      case 'errand': {
        const baseServiceFee = 3000;

        if (errandType && (shoppingErrand || billErrand || documentErrand)) {
          // New structured data
          orderData.errandType = errandType;

          switch (errandType) {
            case 'shopping': {
              if (!shoppingErrand) throw new Error('shoppingErrand data missing');
              const shoppingTotal = shoppingErrand.items.reduce(
                (sum, item) => sum + (item.price * item.quantity), 0
              );
              const shoppingServiceFee = Math.max(shoppingTotal * 0.1, 500);
              orderData.subtotal = shoppingTotal;
              orderData.deliveryFee = baseServiceFee + shoppingServiceFee;
              orderData.total = shoppingTotal + orderData.deliveryFee;
              orderData.shoppingErrand = shoppingErrand;
              break;
            }
            case 'bill': {
              if (!billErrand) throw new Error('billErrand data missing');
              const billAmount = billErrand.amount || 0;
              orderData.subtotal = billAmount;
              orderData.deliveryFee = baseServiceFee;
              orderData.total = billAmount + baseServiceFee;
              orderData.billErrand = billErrand;
              break;
            }
            case 'document': {
              if (!documentErrand) throw new Error('documentErrand data missing');
              const { studentStatus, processingMode } = documentErrand;
              let transcriptFee = 0;
              if (studentStatus === 'Current') {
                transcriptFee = processingMode === 'Fast' ? 3000 : 5000;
              } else { // Past student
                transcriptFee = processingMode === 'Fast' ? 5000 : 7000;
              }
              orderData.subtotal = transcriptFee;
              orderData.deliveryFee = baseServiceFee;
              orderData.total = transcriptFee + baseServiceFee;
              orderData.documentErrand = documentErrand;
              break;
            }
            default:
              throw new Error('Invalid errandType');
          }
        } else if (errandItems && errandItems.length > 0) {
          // Legacy structure – keep existing logic
          const validatedErrandItems = validateErrandItems(errandItems);
          orderData.errandItems = validatedErrandItems;
          const calculatedSubtotal = validatedErrandItems.reduce(
            (sum, item) => sum + (item.price * item.quantity), 0
          );
          const calculatedDeliveryFee = Math.round(calculatedSubtotal * 0.3); // example
          const calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
          orderData.subtotal = calculatedSubtotal;
          orderData.deliveryFee = calculatedDeliveryFee;
          orderData.total = calculatedTotal;
        } else {
          throw new Error('Errand orders require either legacy errandItems or new structured data');
        }
        break;
      }

      case 'ticket': {
        let ticketDetails = {
          busAgency,
          seatNumber,
          passengerName: idCard,
          departureTime,
          destination,
          departureCity,
          price: ticketPrice,
        };

        let parsedNotes = {};
        if (notes && typeof notes === 'string' && notes.trim().startsWith('{')) {
          try {
            parsedNotes = JSON.parse(notes);
          } catch (e) {
            console.warn('Could not parse notes JSON for ticket booking:', e.message);
          }
        }

        ticketDetails = {
          ...ticketDetails,
          backupSeats: parsedNotes.backupSeats || [],
          travelTimeOfDay: travelTimeOfDay || parsedNotes.travelTimeOfDay || 'morning',
          passengerIDNumber: parsedNotes.passengerIDNumber || '',
          idPhotoFront: parsedNotes.idPhotos?.front || '',
          idPhotoBack: parsedNotes.idPhotos?.back || '',
          agencyDetails: parsedNotes.agencyDetails || {},
          serviceFee: parsedNotes.serviceFee || 1500,
          pricePerSeat: parsedNotes.pricePerSeat || 0,
          seatCount: parsedNotes.seatCount || (seatNumber ? seatNumber.split(',').length : 0)
        };

        const ticketData = validateTicketBooking(ticketDetails);
        orderData.ticketData = ticketData;

        // Calculate totals
        const seatPriceTotal = ticketData.pricePerSeat * ticketData.seatCount;
        const serviceFee = ticketData.serviceFee;

        orderData.subtotal = seatPriceTotal;
        orderData.deliveryFee = serviceFee;
        orderData.total = seatPriceTotal + serviceFee;

        orderData.notes = '';
        break;
      }

      case 'random': {
        const deliveryData = validateRandomDelivery({
          pickupAddress: pickupAddress || deliveryAddress,
          deliveryAddress: randomDeliveryAddress || deliveryAddress,
          senderNumber,
          receiverNumber,
          itemDescription,
          price: deliveryPrice
        });
        orderData.deliveryData = deliveryData;

        // Base fee for random delivery is 1000 XAF
        const randomBaseFee = 1000;
        const itemValue = deliveryData.price || 0;

        orderData.subtotal = itemValue;
        orderData.deliveryFee = randomBaseFee;
        orderData.total = itemValue + randomBaseFee;
        break;
      }

      case 'bulk': {
        const validatedBulkData = validateBulkOrder(bulkData);
        orderData.bulkData = validatedBulkData;

        const totalParcels = validatedBulkData.parcels.length;
        const perParcelFee = 750; // fixed per parcel fee

        const totalParcelCost = totalParcels * perParcelFee;
        orderData.deliveryFee = totalParcelCost;
        orderData.total = totalParcelCost;

        if (notes) {
          orderData.notes = notes;
        }
        break;
      }

      default:
        throw new Error('Unknown order type');
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();
    orderData.orderNumber = orderNumber;

    console.log('📦 Final orderData before create:', JSON.stringify(orderData, null, 2));

    // Create order
    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    console.log('✅ Order created successfully:', createdOrder._id);

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
        if (createdOrder.errandType) {
          responseData.errandType = createdOrder.errandType;
          switch (createdOrder.errandType) {
            case 'shopping':
              responseData.shoppingErrand = createdOrder.shoppingErrand;
              break;
            case 'bill':
              responseData.billErrand = createdOrder.billErrand;
              break;
            case 'document':
              responseData.documentErrand = createdOrder.documentErrand;
              break;
          }
        }
        if (createdOrder.errandItems && createdOrder.errandItems.length > 0) {
          responseData.errandItems = createdOrder.errandItems;
        }
        break;
      case 'ticket':
        responseData.ticketData = createdOrder.ticketData;
        break;
      case 'random':
        responseData.deliveryData = createdOrder.deliveryData;
        break;
      case 'bulk':
        responseData.bulkData = createdOrder.bulkData;
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

// ================================
// ORDER RETRIEVAL FUNCTIONS
// ================================

/**
 * Get order by order number – includes full status history
 */
const getOrderByNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const order = await Order.findOne({ orderNumber })
      .populate('user', 'name phone email')
      .populate('rider', 'name phone vehicle plateNumber')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: {
          path: 'business',
          select: 'name deliveryTime'
        }
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const statusHistory = [];

    const addEvent = (status, timestamp) => {
      if (timestamp) {
        statusHistory.push({
          status,
          timestamp,
          description: getStatusDescription(status),
        });
      }
    };

    const getStatusDescription = (status) => {
      const descriptions = {
        pending: 'Order placed and awaiting confirmation',
        confirmed: 'Order confirmed',
        accepted: 'Order accepted by a driver',
        picked_up: 'Driver has picked up the parcel',
        delivered: 'Parcel delivered successfully',
        cancelled: 'Order was cancelled',
        rejected: 'Order was rejected by the driver',
      };
      return descriptions[status] || status;
    };

    addEvent('pending', order.createdAt);
    addEvent('confirmed', order.confirmedAt);
    addEvent('accepted', order.acceptedAt);
    addEvent('picked_up', order.pickedUpAt);
    addEvent('delivered', order.deliveredAt);
    addEvent('cancelled', order.cancelledAt);
    addEvent('rejected', order.rejectedAt);

    statusHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let responseData = {
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      total: order.total,
      deliveryFee: order.deliveryFee,
      subtotal: order.subtotal,
      deliveryAddress: order.deliveryAddress,
      phone: order.phone,
      notes: order.notes,
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      rider: order.rider ? {
        name: order.rider.name,
        phone: order.rider.phone,
        vehicle: order.rider.vehicle,
        plateNumber: order.rider.plateNumber,
      } : null,
      statusHistory,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus
    };

    switch (order.type) {
      case 'business':
        responseData.items = order.items.map((item) => ({
          name: item.product?.name,
          images: item.product?.images || [],
          featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          business: item.product?.business?.name || 'Business not found',
          deliveryTime: item.product?.business?.deliveryTime || 'N/A',
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

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Error fetching order by number:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching order',
      error: error.message,
    });
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
      .select('orderNumber type status total deliveryFee subtotal items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt deliveredAt paymentStatus paymentMethod')
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map(order => {
      const baseOrder = {
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes,
        acceptedAt: order.acceptedAt,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt
      };

      switch (order.type) {
        case 'business':
          baseOrder.items = order.items.map(item => ({
            name: item.product?.name || 'Product not found',
            images: item.product?.images || [],
            featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
            price: item.price,
            quantity: item.quantity,
            business: item.product?.business?.name || 'Business not found',
            deliveryTime: item.product?.business?.deliveryTime || 'N/A'
          }));
          break;

        case 'errand':
          if (order.errandType) {
            baseOrder.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseOrder.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseOrder.billErrand = order.billErrand;
                break;
              case 'document':
                baseOrder.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseOrder.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;

        case 'bulk':
          baseOrder.bulkData = order.bulkData;
          break;
      }

      return baseOrder;
    });

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

// Get single order (by ID)
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
const getConfirmedOrders = async (req, res) => {
  try {
    console.log('📦 Fetching pending orders...');

    const pendingOrders = await Order.find({ status: 'confirmed' })
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
      .select('orderNumber type status total deliveryFee subtotal items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt updatedAt')
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
          if (order.errandType) {
            baseOrder.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseOrder.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseOrder.billErrand = order.billErrand;
                break;
              case 'document':
                baseOrder.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseOrder.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          if (order.deliveryData?.pickupAddress) {
            baseOrder.pickupAddress = order.deliveryData.pickupAddress;
          }
          break;

        case 'bulk':
          baseOrder.bulkData = order.bulkData;
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

// Get rider's completed deliveries
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
    .select('orderNumber type status total deliveryFee items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt')
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
          if (order.errandType) {
            baseDelivery.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseDelivery.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseDelivery.billErrand = order.billErrand;
                break;
              case 'document':
                baseDelivery.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseDelivery.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseDelivery.ticketData = order.ticketData;
          break;

        case 'random':
          baseDelivery.deliveryData = order.deliveryData;
          break;

        case 'bulk':
          baseDelivery.bulkData = order.bulkData;
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

// Accept delivery - using orderNumber instead of orderId
const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;                // Changed from orderId
    const riderId = req.user._id;

    console.log(`🚀 Rider ${riderId} attempting to accept order ${orderNumber}`);

    if (!orderNumber) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order number is required'            // Updated message
      });
    }

    const order = await Order.findOneAndUpdate(
      {
        orderNumber: orderNumber,                       // Query by orderNumber, not _id
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
        message: 'Invalid order number'                 // Updated message
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

// Reject delivery
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

    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      account = await Account.create([{
        user: riderId,
        status: 'active',
        vehicleType: 'bike'
      }], { session });
      account = account[0];
    }

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
    .select('orderNumber type status total deliveryFee items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt')
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
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt
      };

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
          if (order.errandType) {
            baseDelivery.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseDelivery.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseDelivery.billErrand = order.billErrand;
                break;
              case 'document':
                baseDelivery.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseDelivery.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseDelivery.ticketData = order.ticketData;
          break;

        case 'random':
          baseDelivery.deliveryData = order.deliveryData;
          break;

        case 'bulk':
          baseDelivery.bulkData = order.bulkData;
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

// Update order status
const updateOrderStatus = async (req, res) => {
  let session = null;
  
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    console.log('STATUS:::', status);
    const riderId = req.user._id;

    console.log(`🔄 Rider ${riderId} updating order ${orderId} to status: ${status}`);

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

    session = await mongoose.startSession();
    
    if (status === 'delivered') {
      await session.withTransaction(async () => {
        const updateData = {
          status,
          $inc: { __v: 1 }
        };

        if (status === 'picked_up') {
          updateData.pickedUpAt = new Date();
        } else if (status === 'delivered') {
          updateData.deliveredAt = new Date();
          console.log('Setting deliveredAt to', updateData.deliveredAt);
        } else if (status === 'cancelled') {
          updateData.cancelledAt = new Date();
        }

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

        let account = await Account.findOne({ user: riderId }).session(session);
        if (!account) {
          account = await Account.create([{
            user: riderId,
            status: 'active',
            vehicleType: 'bike'
          }], { session });
          account = account[0];
        }

        if (!order.acceptedAt) {
          console.warn(`Order ${order._id} missing acceptedAt, setting to current time`);
          order.acceptedAt = new Date();
        }
        
        account.updatePerformance(order, 'delivered');
        account.updateEarnings(order);
        account.incrementCompleted();
        await account.calculateRanking();
        await account.save({ session });

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
      const updateData = {
        status,
        $inc: { __v: 1 }
      };

      if (status === 'picked_up') {
        updateData.pickedUpAt = new Date();
      } else if (status === 'cancelled') {
        updateData.cancelledAt = new Date();
      }

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

      let account = await Account.findOne({ user: riderId });
      if (!account) {
        account = await Account.create({
          user: riderId,
          status: 'active',
          vehicleType: 'bike'
        });
      }

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

// ================================
// ADMIN PANEL FUNCTIONS
// ================================

// Get all orders (for admin panel)
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
      .select('orderNumber type status total deliveryFee subtotal items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt createdBy isAdminCreated paymentStatus paymentMethod distance rejectedBy rejectedAt')
      .sort({ createdAt: -1 });

    console.log(`✅ ADMIN - Found ${orders.length} total orders`);

    const formattedOrders = orders.map(order => {
      const baseOrder = {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        distance: order.distance || 0,
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
        rejectedAt: order.rejectedAt,
        createdBy: order.createdBy || 'customer',
        isAdminCreated: order.isAdminCreated || false,
        rejectedBy: order.rejectedBy || null
      };

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
          if (order.errandType) {
            baseOrder.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseOrder.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseOrder.billErrand = order.billErrand;
                break;
              case 'document':
                baseOrder.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseOrder.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;

        case 'bulk':
          baseOrder.bulkData = order.bulkData;
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

// Update order (for admin panel)
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`✏️ ADMIN - Updating order ${id}:`, updateData);

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const allowedUpdates = ['status', 'deliveryAddress', 'phone', 'notes', 'rider', 'paymentStatus', 'paymentMethod', 'distance'];
    const updates = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

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
      if (updatedOrder.errandType) {
        responseData.errandType = updatedOrder.errandType;
        switch (updatedOrder.errandType) {
          case 'shopping':
            responseData.shoppingErrand = updatedOrder.shoppingErrand;
            break;
          case 'bill':
            responseData.billErrand = updatedOrder.billErrand;
            break;
          case 'document':
            responseData.documentErrand = updatedOrder.documentErrand;
            break;
        }
      }
      if (updatedOrder.errandItems && updatedOrder.errandItems.length > 0) {
        responseData.errandItems = updatedOrder.errandItems;
      }
    } else if (updatedOrder.type === 'ticket') {
      responseData.ticketData = updatedOrder.ticketData;
    } else if (updatedOrder.type === 'random') {
      responseData.deliveryData = updatedOrder.deliveryData;
    } else if (updatedOrder.type === 'bulk') {
      responseData.bulkData = updatedOrder.bulkData;
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

// Delete order (for admin panel)
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

// Create order for user (admin only)
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
      errandType,
      shoppingErrand,
      billErrand,
      documentErrand,
      // Ticket specific
      busAgency, seatNumber, idCard, departureTime, destination, ticketPrice,
      // Random delivery specific
      pickupAddress, deliveryAddress: randomDeliveryAddress, senderNumber, receiverNumber, itemDescription, deliveryPrice
    } = req.body;

    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required."
      });
    }

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
        if (errandType && (shoppingErrand || billErrand || documentErrand)) {
          orderData.errandType = errandType;
          const baseServiceFee = 3000;
          switch (errandType) {
            case 'shopping':
              if (!shoppingErrand) throw new Error('shoppingErrand data missing');
              const shoppingTotal = shoppingErrand.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
              const shoppingServiceFee = Math.max(shoppingTotal * 0.1, 500);
              orderData.subtotal = shoppingTotal;
              orderData.deliveryFee = baseServiceFee + shoppingServiceFee;
              orderData.total = shoppingTotal + orderData.deliveryFee;
              orderData.shoppingErrand = shoppingErrand;
              break;
            case 'bill':
              if (!billErrand) throw new Error('billErrand data missing');
              const billAmount = billErrand.amount || 0;
              orderData.subtotal = billAmount;
              orderData.deliveryFee = baseServiceFee;
              orderData.total = billAmount + baseServiceFee;
              orderData.billErrand = billErrand;
              break;
            case 'document':
              if (!documentErrand) throw new Error('documentErrand data missing');
              const { studentStatus, processingMode } = documentErrand;
              let transcriptFee = 0;
              if (studentStatus === 'Current') {
                transcriptFee = processingMode === 'Fast' ? 3000 : 5000;
              } else {
                transcriptFee = processingMode === 'Fast' ? 5000 : 7000;
              }
              orderData.subtotal = transcriptFee;
              orderData.deliveryFee = baseServiceFee;
              orderData.total = transcriptFee + baseServiceFee;
              orderData.documentErrand = documentErrand;
              break;
            default:
              throw new Error('Invalid errandType');
          }
        } else if (errandItems && errandItems.length > 0) {
          const validatedErrandItems = validateErrandItems(errandItems);
          orderData.errandItems = validatedErrandItems;
          const calculatedSubtotal = validatedErrandItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
          const calculatedDeliveryFee = Math.round(calculatedSubtotal * 0.3);
          const calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
          orderData.subtotal = calculatedSubtotal;
          orderData.deliveryFee = calculatedDeliveryFee;
          orderData.total = calculatedTotal;
        } else {
          throw new Error('Errand orders require either legacy errandItems or new structured data');
        }
        break;

      case 'ticket':
        const ticketData = validateTicketBooking({
          busAgency, seatNumber, idCard, departureTime, destination, price: ticketPrice
        });
        orderData.ticketData = ticketData;
        const seatPriceTotal = ticketData.pricePerSeat * ticketData.seatCount;
        const serviceFee = ticketData.serviceFee;
        orderData.subtotal = seatPriceTotal;
        orderData.deliveryFee = serviceFee;
        orderData.total = seatPriceTotal + serviceFee;
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
        const randomBaseFee = 1000;
        const itemValue = deliveryData.price || 0;
        orderData.subtotal = itemValue;
        orderData.deliveryFee = randomBaseFee;
        orderData.total = itemValue + randomBaseFee;
        break;
    }

    const orderNumber = await generateOrderNumber();
    orderData.orderNumber = orderNumber;

    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    await createdOrder.populate('user', 'name phone email');
    
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

    const notificationResult = await sendOrderNotifications(createdOrder);

    await session.commitTransaction();

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
        if (createdOrder.errandType) {
          responseData.errandType = createdOrder.errandType;
          switch (createdOrder.errandType) {
            case 'shopping':
              responseData.shoppingErrand = createdOrder.shoppingErrand;
              break;
            case 'bill':
              responseData.billErrand = createdOrder.billErrand;
              break;
            case 'document':
              responseData.documentErrand = createdOrder.documentErrand;
              break;
          }
        }
        if (createdOrder.errandItems && createdOrder.errandItems.length > 0) {
          responseData.errandItems = createdOrder.errandItems;
        }
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

// Get rider orders (admin only)
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

    const commissionRate = rider.commission || 0.75;

    const query = { rider: riderId };
    
    if (status) {
      if (status === 'all') {
        query.status = { $in: ['accepted', 'picked_up', 'delivered', 'cancelled', 'rejected'] };
      } else if (status === 'active') {
        query.status = { $in: ['accepted', 'picked_up'] };
      } else if (status === 'completed') {
        query.status = 'delivered';
      } else {
        query.status = status;
      }
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

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
      .select('orderNumber type status total deliveryFee subtotal items errandItems errandType shoppingErrand billErrand documentErrand ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt rejectedAt paymentStatus paymentMethod distance')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Order.countDocuments(query);

    console.log(`✅ ADMIN - Found ${orders.length} orders for rider ${riderId}`);

    let totalDeliveryFees = 0;
    let totalRiderEarnings = 0;

    const formattedOrders = orders.map(order => {
      const deliveryFee = order.deliveryFee || 0;
      const riderEarnings = Math.round(deliveryFee * commissionRate * 100) / 100;
      
      totalDeliveryFees += deliveryFee;
      totalRiderEarnings += riderEarnings;

      const baseOrder = {
        id: order._id,
        orderNumber: order.orderNumber,
        type: order.type,
        status: order.status,
        total: order.total,
        deliveryFee: deliveryFee,
        riderEarnings: riderEarnings,
        commissionRate: commissionRate,
        subtotal: order.subtotal,
        paymentStatus: order.paymentStatus || 'unpaid',
        paymentMethod: order.paymentMethod || 'cash',
        distance: order.distance || 0,
        customer: {
          name: order.user?.name || 'Customer',
          phone: order.user?.phone || order.phone
        },
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes || '',
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        rejectedAt: order.rejectedAt
      };

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
          if (order.errandType) {
            baseOrder.errandType = order.errandType;
            switch (order.errandType) {
              case 'shopping':
                baseOrder.shoppingErrand = order.shoppingErrand;
                break;
              case 'bill':
                baseOrder.billErrand = order.billErrand;
                break;
              case 'document':
                baseOrder.documentErrand = order.documentErrand;
                break;
            }
          }
          if (order.errandItems && order.errandItems.length > 0) {
            baseOrder.errandItems = order.errandItems;
          }
          break;

        case 'ticket':
          baseOrder.ticketData = order.ticketData;
          break;

        case 'random':
          baseOrder.deliveryData = order.deliveryData;
          break;

        case 'bulk':
          baseOrder.bulkData = order.bulkData;
          break;
      }

      return baseOrder;
    });

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
      totalDeliveryFees: aggregatedTotalDeliveryFees,
      totalEarnings: calculatedTotalEarnings,
      commissionRate: commissionRate,
      platformShare: Math.round(aggregatedTotalDeliveryFees * (1 - commissionRate) * 100) / 100
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
          commission: commissionRate
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

// Get orders by business ID
const getOrdersByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    console.log(`🏪 Fetching orders for business ${businessId}`);

    const business = await Business.findById(businessId).select('name phone address owner');
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const isBusinessOwner = business.owner && business.owner.toString() === req.user._id.toString();
    const isAuthorized = req.user.role === 'admin' || 'vendor';
    
    if (!isBusinessOwner && !isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized to view orders for this business.'
      });
    }

    const query = { type: 'business' };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

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

    const filteredOrders = orders.map(order => {
      const businessItems = order.items.filter(item => {
        if (!item.product || !item.product.business) return false;
        const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
        return itemBusinessId === businessId;
      });

      if (businessItems.length === 0) {
        return null;
      }

      console.log(`🛒 Order ${order.orderNumber}: ${businessItems.length} items from ${business.name}`);

      const businessSubtotal = businessItems.reduce((sum, item) => 
        sum + (item.price * item.quantity), 0
      );

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
    }).filter(order => order !== null);

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
      if (order.status === 'pending') stats.pendingOrders++;
      if (order.status === 'accepted') stats.acceptedOrders++;
      if (order.status === 'delivered') stats.deliveredOrders++;
      if (order.status === 'cancelled') stats.cancelledOrders++;

      if (order.status === 'delivered') {
        stats.totalRevenue += order.businessSubtotal;
      }
    });

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

// Get business order statistics
const getBusinessOrderStats = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { period = 'month' } = req.query;

    console.log(`📊 Fetching order stats for business ${businessId} for period: ${period}`);

    const business = await Business.findById(businessId).select('name owner');
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const isBusinessOwner = business.owner && business.owner.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (!isBusinessOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized to view stats for this business.'
      });
    }

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

    const businessOrders = allOrders.filter(order => 
      order.items.some(item => {
        if (!item.product || !item.product.business) return false;
        const itemBusinessId = item.product.business._id?.toString() || item.product.business?.toString();
        return itemBusinessId === businessId;
      })
    );

    console.log(`✅ Found ${businessOrders.length} orders for ${business.name}`);

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
      statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;

      if (order.status === 'delivered') {
        deliveredCount++;
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

    const dailyTrends = [];
    const dailyRevenue = {};

    businessOrders.forEach(order => {
      if (order.status === 'delivered') {
        const dateStr = order.createdAt.toISOString().split('T')[0];
        
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

    Object.keys(dailyRevenue).forEach(date => {
      dailyTrends.push({
        _id: date,
        orders: dailyRevenue[date].orders,
        revenue: dailyRevenue[date].revenue
      });
    });

    dailyTrends.sort((a, b) => a._id.localeCompare(b._id));

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

// Cancel order (customer only)
const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;

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

    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in "${order.status}" status. Only pending orders can be cancelled.`,
      });
    }

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

// Delete my order (customer only)
const deleteMyOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;

    console.log('orderNumber:::', orderNumber);

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

// Confirm order after payment
const confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;
    const paymentMethod = req.query.pm || 'momo';

    const allowedMethods = ['cash', 'momo'];
    if (!allowedMethods.includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Allowed: ${allowedMethods.join(', ')}`,
      });
    }

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

    if (order.status === 'confirmed') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Order is already confirmed',
      });
    }

    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot confirm order with status "${order.status}"`,
      });
    }

    order.status = 'confirmed';
    order.paymentMethod = paymentMethod;

    if (paymentMethod === 'momo') {
      order.paymentStatus = 'paid';
    } else if (paymentMethod === 'cash') {
      order.paymentStatus = 'unpaid';
    }

    order.confirmedAt = new Date();
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        confirmedAt: order.confirmedAt,
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
  getConfirmedOrders,
  getMyCompletedDeliveries,
  acceptDelivery,
  rejectDelivery,
  getMyActiveDeliveries,
  updateOrderStatus,
  getAllOrders,
  updateOrder,
  deleteOrder,
  createOrderForUser,
  getRiderOrders,
  getOrdersByBusiness,
  getBusinessOrderStats,
  confirmOrder,
  getOrderByNumber
};