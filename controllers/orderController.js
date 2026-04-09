/**
 * controllers/orderController.js
 * Full delivery/order logic with WhatsApp notifications via WASenderApi.
 * Includes 6-second delays and retry logic.
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const Account = require("../models/Account");
const User = require("../models/User");
const Store = require("../models/Store");
const Business = require("../models/Business");
const mongoose = require("mongoose");

const { sendOrderNotification } = require("../services/messageServices");

// ================================
// HELPER: SLEEP FOR RATE LIMITING
// ================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================================
// HELPER: NOTIFICATION FORMATTING
// ================================

const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("237") && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 9 && /^[6-9]/.test(cleaned)) return `+237${cleaned}`;
  if (cleaned.length === 12) return `+${cleaned}`;
  if (phone.startsWith("+") && phone.length >= 8) return phone;
  return null;
};

const getRiderPhones = async () => {
  const riders = await User.find({ role: "rider", isApproved: true, isActive: true }).select("phone");
  return riders.map(r => formatPhoneNumber(r.phone)).filter(Boolean);
};

const notifyRecipient = async (phoneNumber, orderDetails) => {
  if (!phoneNumber) return;
  try {
    await sendOrderNotification(phoneNumber, orderDetails);
    console.log(`✅ Notification sent to ${phoneNumber} for order ${orderDetails.orderNumber}`);
  } catch (err) {
    if (err.message && err.message.includes('JID does not exist')) {
      console.warn(`⚠️ Phone ${phoneNumber} is not a WhatsApp account – skipping`);
    } else {
      console.error(`❌ Failed to send notification to ${phoneNumber}:`, err.message);
    }
  }
};

const notifyClient = async (order, status, extra = {}) => {
  const clientPhone = formatPhoneNumber(order.phone);
  if (!clientPhone) return;
  const orderDetails = {
    orderNumber: order.orderNumber,
    status: status,
    type: order.type,
    items: order.items?.map(item => ({
      name: item.product?.name || item.name,
      quantity: item.quantity,
      price: item.price,
    })) || [],
    errandItems: order.errandItems || [],
    ticketData: order.ticketData || {},
    deliveryData: order.deliveryData || {},
    bulkData: order.bulkData || {},
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    deliveryAddress: order.deliveryAddress,
    pickupAddress: order.deliveryData?.pickupAddress || order.bulkData?.pickupAddress || '',
    customerName: order.user?.name || '',
    notes: order.notes,
    createdAt: order.createdAt,
    riderName: extra.riderName || null,
  };
  await notifyRecipient(clientPhone, orderDetails);
};

const notifyRiders = async (order) => {
  const riderPhones = await getRiderPhones();
  if (riderPhones.length === 0) return;
  const orderDetails = {
    orderNumber: order.orderNumber,
    status: "New Order Available",
    type: order.type,
    total: order.total,
    deliveryAddress: order.deliveryAddress,
    itemsCount: order.items ? order.items.length : 0,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    customerName: order.user?.name || '',
    notes: order.notes,
    createdAt: order.createdAt,
  };
  for (let i = 0; i < riderPhones.length; i++) {
    await notifyRecipient(riderPhones[i], orderDetails);
    if (i < riderPhones.length - 1) await sleep(6000); // 6 seconds delay
  }
  console.log(`Notified ${riderPhones.length} riders about order ${order.orderNumber}`);
};

const notifyAdmin = async (order, type) => {
  const adminPhone = process.env.ADMIN_NOTIFICATION_PHONE;
  if (!adminPhone) return;
  const orderDetails = {
    orderNumber: order.orderNumber,
    status: `New ${type} order`,
    type: type,
    total: order.total,
    itemsCount: type === "errand" ? (order.errandItems?.length || 0) : 1,
    deliveryAddress: order.deliveryAddress,
    customerName: order.user?.name || '',
    createdAt: order.createdAt,
  };
  await notifyRecipient(adminPhone, orderDetails);
};

const notifyBusinessesForOrder = async (order) => {
  const businessIds = [...new Set(order.items.map(item => item.business?.toString()).filter(Boolean))];
  if (businessIds.length === 0) return;
  const businesses = await Store.find({ _id: { $in: businessIds } }).select("phone whatsappNumber name");
  for (let i = 0; i < businesses.length; i++) {
    const biz = businesses[i];
    const bizPhone = formatPhoneNumber(biz.whatsappNumber || biz.phone);
    if (!bizPhone) continue;
    const businessItems = order.items.filter(item => item.business?.toString() === biz._id.toString());
    const bizSubtotal = businessItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderDetails = {
      orderNumber: order.orderNumber,
      status: "New Order",
      type: "business",
      total: bizSubtotal,
      itemsCount: businessItems.length,
      items: businessItems.map(item => ({
        name: item.product?.name || item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      deliveryAddress: order.deliveryAddress,
      customerName: order.user?.name || '',
      notes: order.notes,
      createdAt: order.createdAt,
    };
    await notifyRecipient(bizPhone, orderDetails);
    if (i < businesses.length - 1) await sleep(6000); // 6 seconds delay
  }
};

// ================================
// ORDER VALIDATION FUNCTIONS (original)
// ================================
const validateErrandItems = (items) => {
  if (!items || items.length === 0) throw new Error("Errand must have at least one item");
  return items.map((item, index) => {
    if (!item.name || !item.price) throw new Error(`Item ${index + 1}: name and price are required`);
    if (typeof item.price !== 'number' || item.price < 0) throw new Error(`Item ${index + 1}: price must be a positive number`);
    if (!item.quantity || item.quantity < 1) throw new Error(`Item ${index + 1}: quantity must be at least 1`);
    return { name: item.name, price: item.price, quantity: item.quantity || 1, description: item.description || '' };
  });
};

const validateTicketBooking = (data) => {
  if (!data.busAgency || !data.seatNumber || !data.passengerName || !data.departureTime || !data.destination || !data.departureCity)
    throw new Error('Missing required ticket booking fields');
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

const validateRandomDelivery = (deliveryData) => {
  const { pickupAddress, deliveryAddress, senderNumber, receiverNumber, itemDescription } = deliveryData;
  if (!pickupAddress) throw new Error("Pickup address is required");
  if (!deliveryAddress) throw new Error("Delivery address is required");
  if (!senderNumber) throw new Error("Sender number is required");
  if (!receiverNumber) throw new Error("Receiver number is required");
  if (!itemDescription) throw new Error("Item description is required");
  return { pickupAddress, deliveryAddress, senderNumber, receiverNumber, itemDescription, price: deliveryData.price || 0 };
};

const validateBusinessOrder = async (items) => {
  if (!items || items.length === 0) throw new Error("No items in order");
  let subtotal = 0;
  const orderItems = [];
  const businessDeliveryFees = new Map();
  const businessIds = new Set();

  for (const item of items) {
    const product = await Product.findById(item.product).populate("business");
    if (!product) throw new Error(`Product not found: ${item.product}`);
    if (!product.inStock) throw new Error(`${product.name} is out of stock`);
    if (!product.business) throw new Error(`Product ${product.name} is not associated with any business`);
    const price = product.discount > 0 ? product.price * (1 - product.discount / 100) : product.price;
    const itemTotal = price * item.quantity;
    subtotal += itemTotal;
    const businessId = product.business._id.toString();
    businessIds.add(businessId);
    if (!businessDeliveryFees.has(businessId)) businessDeliveryFees.set(businessId, product.business.deliveryFee || 1000);
    orderItems.push({ product: product._id, business: product.business._id, quantity: item.quantity, price: price });
  }
  const totalBusinessDeliveryFees = Array.from(businessDeliveryFees.values()).reduce((sum, fee) => sum + fee, 0);
  const deliveryFee = Math.round(totalBusinessDeliveryFees);
  const total = subtotal + deliveryFee;
  return { orderItems, subtotal, deliveryFee, total, businessIds: Array.from(businessIds) };
};

const validateBulkOrder = (bulkData) => {
  if (!bulkData) throw new Error('Bulk data is required');
  const { type, parcels, scheduledDate, scheduledTime } = bulkData;
  if (!type || !['pickup', 'delivery'].includes(type)) throw new Error('Bulk type must be either "pickup" or "delivery"');
  if (!scheduledDate || !scheduledTime) throw new Error('Scheduled date and time are required');
  if (!parcels || !Array.isArray(parcels) || parcels.length < 2) throw new Error('At least 2 parcels are required');
  parcels.forEach((parcel, index) => {
    if (!parcel.description || parcel.description.trim() === '') throw new Error(`Parcel ${index + 1}: description is required`);
    if (type === 'pickup') {
      if (!parcel.pickupAddress || !parcel.pickupContactName || !parcel.pickupContactPhone)
        throw new Error(`Parcel ${index + 1}: pickup address, contact name and phone are required`);
    } else {
      if (!parcel.deliveryAddress || !parcel.receiverName || !parcel.receiverPhone)
        throw new Error(`Parcel ${index + 1}: delivery address, receiver name and phone are required`);
    }
  });
  if (type === 'pickup') {
    if (!bulkData.receiverName || !bulkData.receiverPhone || !bulkData.receiverAddress)
      throw new Error('Receiver name, phone and address are required for bulk pickup');
  } else {
    if (!bulkData.pickupContactName || !bulkData.pickupContactPhone || !bulkData.pickupAddress)
      throw new Error('Pickup contact name, phone and address are required for bulk delivery');
  }
  return {
    type, parcels, scheduledDate, scheduledTime,
    receiverName: type === 'pickup' ? bulkData.receiverName : undefined,
    receiverPhone: type === 'pickup' ? bulkData.receiverPhone : undefined,
    receiverAddress: type === 'pickup' ? bulkData.receiverAddress : undefined,
    pickupContactName: type === 'delivery' ? bulkData.pickupContactName : undefined,
    pickupContactPhone: type === 'delivery' ? bulkData.pickupContactPhone : undefined,
    pickupAddress: type === 'delivery' ? bulkData.pickupAddress : undefined,
  };
};

const generateOrderNumber = async () => {
  const count = await Order.countDocuments();
  return `ORD${Date.now()}${count + 1}`;
};

// ================================
// CREATE ORDER (CUSTOMER)
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
      errandItems,
      busAgency,
      seatNumber,
      idCard,
      departureTime,
      travelTimeOfDay,
      destination,
      ticketPrice,
      pickupAddress,
      deliveryAddress: randomDeliveryAddress,
      senderNumber,
      receiverNumber,
      itemDescription,
      deliveryPrice,
      departureCity,
      bulkData
    } = req.body;

    if (!req.user) {
      await session.abortTransaction();
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!['business', 'errand', 'ticket', 'random', 'bulk'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Valid order type required" });
    }

    if (!deliveryAddress || !phone) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Delivery address and phone are required" });
    }

    let orderData = { user: req.user._id, type, deliveryAddress, phone, notes: notes || "" };
    let businessIds = [];
    let calculatedTotal = 0, calculatedSubtotal = 0, calculatedDeliveryFee = 0;

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
        calculatedDeliveryFee = 1000;
        calculatedTotal = calculatedSubtotal + calculatedDeliveryFee;
        orderData.subtotal = calculatedSubtotal;
        orderData.deliveryFee = calculatedDeliveryFee;
        orderData.total = calculatedTotal;
        break;
      case 'ticket':
        let ticketDetails = {
          busAgency, seatNumber, passengerName: idCard, departureTime, destination, departureCity,
          price: ticketPrice
        };
        if (notes && typeof notes === 'string' && notes.trim().startsWith('{')) {
          try {
            const parsedNotes = JSON.parse(notes);
            ticketDetails = { ...ticketDetails, ...parsedNotes };
          } catch (e) {}
        }
        const ticketData = validateTicketBooking(ticketDetails);
        orderData.ticketData = ticketData;
        const seatPriceTotal = ticketData.pricePerSeat * ticketData.seatCount;
        const serviceFee = ticketData.serviceFee;
        orderData.subtotal = seatPriceTotal;
        orderData.deliveryFee = serviceFee;
        orderData.total = seatPriceTotal + serviceFee;
        orderData.notes = '';
        break;
      case 'random':
        const deliveryData = validateRandomDelivery({
          pickupAddress: pickupAddress || deliveryAddress,
          deliveryAddress: randomDeliveryAddress || deliveryAddress,
          senderNumber, receiverNumber, itemDescription, price: deliveryPrice
        });
        orderData.deliveryData = deliveryData;
        orderData.subtotal = deliveryData.price || 0;
        orderData.deliveryFee = 1000;
        orderData.total = (deliveryData.price || 0) + 1000;
        break;
      case 'bulk':
        const validatedBulkData = validateBulkOrder(bulkData);
        orderData.bulkData = validatedBulkData;
        const totalParcels = validatedBulkData.parcels.length;
        orderData.subtotal = totalParcels * 750;
        orderData.deliveryFee = 0;
        orderData.total = orderData.subtotal;
        break;
    }

    orderData.orderNumber = await generateOrderNumber();
    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    await createdOrder.populate('user', 'name phone');
    if (type === 'business') {
      await createdOrder.populate({
        path: "items.product",
        select: "name images price featuredImage business",
        populate: { path: "business", select: "name deliveryTime phone address" }
      });
    }

    // Send admin notification for non‑business orders immediately
    if (type !== 'business') {
      await notifyAdmin(createdOrder, type);
    }

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
        responseData.items = createdOrder.items.map(item => ({
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
      case 'bulk':
        responseData.bulkData = createdOrder.bulkData;
        break;
    }

    res.status(201).json({
      success: true,
      data: responseData,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} order created successfully!`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Order creation error:", error);
    res.status(500).json({ success: false, message: "Server error creating order", error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// CONFIRM ORDER (customer) – also accessible by admin
// ================================
const confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const userId = req.user._id;
    const paymentMethod = req.query.pm || 'momo';
    const userRole = req.user.role;

    console.log(`[CONFIRM] Order number: ${orderNumber}, userId: ${userId}, role: ${userRole}, paymentMethod: ${paymentMethod}`);

    const allowedMethods = ['cash', 'momo'];
    if (!allowedMethods.includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }

    let order;
    if (req.user.role === 'admin') {
      order = await Order.findOne({ orderNumber }).session(session);
      console.log(`[CONFIRM] Admin confirming order: ${orderNumber}`);
    } else {
      order = await Order.findOne({ orderNumber, user: userId }).session(session);
      console.log(`[CONFIRM] Client confirming order: ${orderNumber}`);
    }

    if (!order) {
      await session.abortTransaction();
      console.log(`[CONFIRM] Order not found`);
      return res.status(404).json({ success: false, message: 'Order not found or not authorized' });
    }
    console.log(`[CONFIRM] Order found: status=${order.status}, type=${order.type}, user=${order.user}`);

    if (order.status === 'confirmed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Order already confirmed' });
    }
    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Cannot confirm order with status "${order.status}"` });
    }

    order.status = 'confirmed';
    order.paymentMethod = paymentMethod;
    if (paymentMethod === 'momo') order.paymentStatus = 'paid';
    else order.paymentStatus = 'unpaid';
    order.confirmedAt = new Date();
    await order.save({ session });
    console.log(`[CONFIRM] Order saved, new status: ${order.status}`);

    await session.commitTransaction();
    console.log(`[CONFIRM] Transaction committed`);

    // Re-populate order for notifications
    const populatedOrder = await Order.findById(order._id)
      .populate('user', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name price',
        populate: { path: 'business', select: 'name' }
      });
    console.log(`[CONFIRM] Populated order: user=${populatedOrder.user?.name}, phone=${populatedOrder.phone}, items count=${populatedOrder.items?.length}`);

    // Send notifications
    console.log(`[CONFIRM] Sending notifications...`);
    await notifyClient(populatedOrder, 'Confirmed', { itemsCount: populatedOrder.items?.length || 0 });
    await notifyRiders(populatedOrder);
    if (populatedOrder.type === 'business') {
      await notifyBusinessesForOrder(populatedOrder);
    }
    console.log(`[CONFIRM] Notifications sent`);

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
    res.status(500).json({ success: false, message: 'Failed to confirm order', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// ADMIN CONFIRM ORDER (explicit admin endpoint)
// ================================
const adminConfirmOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const paymentMethod = req.query.pm || 'momo';

    const allowedMethods = ['cash', 'momo'];
    if (!allowedMethods.includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }

    const order = await Order.findOne({ orderNumber }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (order.status === 'confirmed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Order already confirmed' });
    }
    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Cannot confirm order with status "${order.status}"` });
    }

    order.status = 'confirmed';
    order.paymentMethod = paymentMethod;
    if (paymentMethod === 'momo') order.paymentStatus = 'paid';
    else order.paymentStatus = 'unpaid';
    order.confirmedAt = new Date();
    await order.save({ session });

    await session.commitTransaction();

    await notifyClient(order, 'Confirmed', { itemsCount: order.items ? order.items.length : 0 });
    await notifyRiders(order);
    if (order.type === 'business') {
      await notifyBusinessesForOrder(order);
    }

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        confirmedAt: order.confirmedAt,
      },
      message: 'Order confirmed by admin successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Admin confirm order error:', error);
    res.status(500).json({ success: false, message: 'Failed to confirm order', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// ACCEPT DELIVERY (rider)
// ================================
const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderNumber } = req.params;
    const riderId = req.user._id;

    const rider = await User.findById(riderId).session(session);
    if (!rider) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Rider not found' });
    }
    if (!rider.isProfileComplete || !rider.isApproved) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Rider profile incomplete or not approved' });
    }

    const order = await Order.findOneAndUpdate(
      { orderNumber: orderNumber, status: 'confirmed' },
      {
        status: 'accepted',
        rider: riderId,
        acceptedAt: new Date(),
        $inc: { __v: 1 },
      },
      { new: true, session }
    ).populate('user', 'name phone');

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found or already taken' });
    }

    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      account = await Account.create([{ user: riderId, status: 'active', vehicleType: 'bike' }], { session });
      account = account[0];
    }
    account.incrementAccepted();
    account.updatePerformance(order);
    await account.save({ session });

    await session.commitTransaction();

    await notifyClient(order, 'Accepted', { riderName: rider.name });

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        acceptedAt: order.acceptedAt,
      },
      message: 'Delivery accepted successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Accept delivery error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept delivery', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// UPDATE ORDER STATUS (picked_up, delivered, cancelled)
// ================================
const updateOrderStatus = async (req, res) => {
  let session = null;
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const riderId = req.user._id;

    const validStatuses = ['picked_up', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    if (status === 'delivered') {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const order = await Order.findOneAndUpdate(
          { _id: orderId, rider: riderId, status: { $in: ['accepted', 'picked_up'] } },
          { status, deliveredAt: new Date(), $inc: { __v: 1 } },
          { new: true, session }
        ).populate('user', 'name phone');
        if (!order) throw new Error('Order not found or unauthorized');

        let account = await Account.findOne({ user: riderId }).session(session);
        if (!account) {
          account = await Account.create([{ user: riderId, status: 'active', vehicleType: 'bike' }], { session });
          account = account[0];
        }
        const driverShare = Math.round(Number(order.deliveryFee) * (process.env.DRIVER_COMMISSION_RATE || 0.75) * 100) / 100;
        account.updatePerformance(order, 'delivered');
        account.updateEarnings(order);
        account.incrementCompleted();
        await account.calculateRanking();
        await account.save({ session });

        const user = await User.findById(riderId).session(session);
        if (user) {
          user.pushDeliveryMeta({
            orderId: order._id,
            orderNumber: order.orderNumber,
            deliveredAt: order.deliveredAt,
            acceptedAt: order.acceptedAt,
            deliveryFee: order.deliveryFee,
            earnings: driverShare,
          });
          await user.save({ session });
        }

        await notifyClient(order, 'Delivered');
      });
    } else {
      const order = await Order.findOneAndUpdate(
        { _id: orderId, rider: riderId, status: { $in: ['accepted', 'picked_up'] } },
        { status, [status === 'picked_up' ? 'pickedUpAt' : 'cancelledAt']: new Date(), $inc: { __v: 1 } },
        { new: true }
      ).populate('user', 'name phone');
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found or unauthorized' });
      }

      if (status === 'picked_up') {
        const account = await Account.findOne({ user: riderId });
        if (account) {
          account.updatePerformance(order, 'picked_up');
          await account.save();
        }
        await notifyClient(order, 'Picked Up');
      } else if (status === 'cancelled') {
        const account = await Account.findOne({ user: riderId });
        if (account) {
          account.updatePerformance(order, 'cancelled');
          await account.save();
        }
        await notifyClient(order, 'Cancelled');
      }
    }

    res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update order status', error: error.message });
  } finally {
    if (session) session.endSession();
  }
};

// ================================
// REJECT DELIVERY (rider)
// ================================
const rejectDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const riderId = req.user._id;

    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: 'pending' },
      { status: 'rejected', rejectedBy: riderId, rejectedAt: new Date(), $inc: { __v: 1 } },
      { new: true, session }
    );

    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found or cannot be rejected' });
    }

    let account = await Account.findOne({ user: riderId }).session(session);
    if (!account) {
      account = await Account.create([{ user: riderId, status: 'active', vehicleType: 'bike' }], { session });
      account = account[0];
    }
    account.updatePerformance(order, 'rejected');
    await account.save({ session });

    await session.commitTransaction();
    res.json({ success: true, message: 'Delivery rejected successfully' });
  } catch (error) {
    await session.abortTransaction();
    console.error('Reject delivery error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject delivery', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// GET MY ORDERS (customer)
// ================================
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name deliveryTime _id' }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt deliveredAt paymentStatus paymentMethod')
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
      if (order.type === 'business') {
        baseOrder.items = order.items.map(item => ({
          product: item.product?._id,
          store: item.product?.business?._id,
          name: item.product?.name || 'Product not found',
          images: item.product?.images || [],
          featuredImage: item.product?.featuredImage || (item.product?.images?.[0] || ''),
          price: item.price,
          quantity: item.quantity,
          business: item.product?.business?.name || 'Business not found',
          deliveryTime: item.product?.business?.deliveryTime || 'N/A'
        }));
      } else if (order.type === 'errand') baseOrder.errandItems = order.errandItems;
      else if (order.type === 'ticket') baseOrder.ticketData = order.ticketData;
      else if (order.type === 'random') baseOrder.deliveryData = order.deliveryData;
      else if (order.type === 'bulk') baseOrder.bulkData = order.bulkData;
      return baseOrder;
    });
    res.json({ success: true, data: formattedOrders });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ================================
// GET ORDER BY ID
// ================================
const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("rider", "name phone")
      .populate("user", "name phone")
      .populate({
        path: "items.product",
        select: "name images price featuredImage business",
        populate: { path: "business", select: "name address phone" }
      });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ================================
// GET ORDER BY ORDER NUMBER
// ================================
const getOrderByNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber })
      .populate('user', 'name phone email')
      .populate('rider', 'name phone vehicle plateNumber')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name address phone deliveryTime _id' }
      });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Get order by number error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ================================
// CANCEL ORDER (customer)
// ================================
const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber, user: req.user._id }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found or not authorized' });
    }
    if (order.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Cannot cancel order with status "${order.status}"` });
    }
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    await order.save({ session });
    await session.commitTransaction();
    res.json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    await session.abortTransaction();
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel order', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// DELETE MY ORDER (customer)
// ================================
const deleteMyOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber, user: req.user._id }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Order not found or not authorized' });
    }
    if (!['cancelled', 'pending'].includes(order.status)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Cannot delete order with status "${order.status}"` });
    }
    await Order.deleteOne({ _id: order._id }).session(session);
    await session.commitTransaction();
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    await session.abortTransaction();
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete order', error: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// GET CONFIRMED ORDERS (for riders)
// ================================
const getConfirmedOrders = async (req, res) => {
  try {
    const orders = await Order.find({ status: 'confirmed' })
      .populate('user', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name address phone deliveryTime _id' }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData bulkData deliveryAddress phone notes createdAt')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Get confirmed orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch confirmed orders' });
  }
};

// ================================
// RIDER ACTIVE DELIVERIES
// ================================
const getMyActiveDeliveries = async (req, res) => {
  try {
    const orders = await Order.find({ rider: req.user._id, status: { $in: ['accepted', 'picked_up'] } })
      .populate('user', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name address deliveryTime coordinates phone _id' }
      })
      .select('orderNumber type status total deliveryFee items errandItems ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt')
      .sort({ acceptedAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Get active deliveries error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch active deliveries' });
  }
};

// ================================
// RIDER COMPLETED DELIVERIES
// ================================
const getMyCompletedDeliveries = async (req, res) => {
  try {
    const orders = await Order.find({ rider: req.user._id, status: 'delivered' })
      .populate('user', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name address phone _id' }
      })
      .select('orderNumber type status total deliveryFee items errandItems ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt')
      .sort({ deliveredAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Get completed deliveries error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch completed deliveries' });
  }
};

// ================================
// ADMIN: GET ALL ORDERS
// ================================
const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'name phone email')
      .populate('rider', 'name phone')
      .populate({
        path: 'items.product',
        select: 'name images price featuredImage business',
        populate: { path: 'business', select: 'name phone address deliveryTime _id' }
      })
      .select('orderNumber type status total deliveryFee subtotal items errandItems ticketData deliveryData bulkData deliveryAddress phone notes createdAt acceptedAt pickedUpAt deliveredAt cancelledAt paymentStatus paymentMethod')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

// ================================
// ADMIN: UPDATE ORDER
// ================================
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const order = await Order.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order, message: 'Order updated successfully' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
};

// ================================
// ADMIN: DELETE ORDER
// ================================
const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['accepted', 'picked_up'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Cannot delete order in progress' });
    }
    await Order.findByIdAndDelete(id);
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
};

// ================================
// ADMIN: CREATE ORDER FOR USER
// ================================
const createOrderForUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, type = 'business', items, deliveryAddress, phone, notes } = req.body;
    if (!userId) throw new Error('User ID is required');
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    let orderData = { user: userId, type, deliveryAddress, phone, notes: notes || "", createdBy: req.user._id, isAdminCreated: true };
    let calculatedTotal = 0, calculatedSubtotal = 0, calculatedDeliveryFee = 0;

    if (type === 'business') {
      const businessResult = await validateBusinessOrder(items);
      orderData.items = businessResult.orderItems;
      orderData.subtotal = businessResult.subtotal;
      orderData.deliveryFee = businessResult.deliveryFee;
      orderData.total = businessResult.total;
    } else {
      // For simplicity, set default values for other types
      orderData.subtotal = 0;
      orderData.deliveryFee = 1000;
      orderData.total = 1000;
    }

    orderData.orderNumber = await generateOrderNumber();
    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];
    await session.commitTransaction();
    res.status(201).json({ success: true, data: createdOrder, message: 'Order created for user successfully' });
  } catch (error) {
    await session.abortTransaction();
    console.error('Admin create order error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ================================
// ADMIN: GET RIDER ORDERS
// ================================
const getRiderOrders = async (req, res) => {
  try {
    const { riderId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;
    const query = { rider: riderId };
    if (status && status !== 'all') query.status = status;
    const orders = await Order.find(query)
      .populate('user', 'name phone')
      .populate('items.product', 'name images')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    const total = await Order.countDocuments(query);
    res.json({ success: true, data: orders, pagination: { total, page, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Get rider orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch rider orders' });
  }
};

// ================================
// BUSINESS: GET ORDERS BY BUSINESS
// ================================
const getOrdersByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ success: false, message: 'Business not found' });
    const orders = await Order.find({ type: 'business' })
      .populate({
        path: 'items.product',
        populate: { path: 'business', match: { _id: businessId } }
      })
      .lean();
    const filteredOrders = orders.filter(order =>
      order.items.some(item => item.product?.business?._id?.toString() === businessId)
    );
    res.json({ success: true, data: filteredOrders });
  } catch (error) {
    console.error('Get orders by business error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch business orders' });
  }
};

// ================================
// BUSINESS: GET ORDER STATS
// ================================
const getBusinessOrderStats = async (req, res) => {
  try {
    const { businessId } = req.params;
    const orders = await Order.find({ type: 'business' }).lean();
    const stats = { totalOrders: orders.length, deliveredOrders: orders.filter(o => o.status === 'delivered').length };
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get business stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
};

// ================================
// EXPORTS
// ================================
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
  adminConfirmOrder,
  getOrderByNumber,
};