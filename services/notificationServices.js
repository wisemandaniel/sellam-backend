const User = require("../models/User");
const Store = require("../models/Store");
const axios = require("axios");
const { sendOrderNotification } = require("./messageServices");

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

// Client notification – full details
const notifyClient = async (order, status, extra = {}) => {
  const clientPhone = formatPhoneNumber(order.phone);
  if (!clientPhone) {
    console.warn(`No client phone for order ${order.orderNumber}`);
    return;
  }
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
    pickupAddress: order.deliveryData?.pickupAddress || '',
    customerName: order.user?.name || '',
    notes: order.notes,
    createdAt: order.createdAt,
    riderName: extra.riderName || null,
  };
  await notifyRecipient(clientPhone, orderDetails);
};

// Rider notification – simplified, using plain WhatsApp message
const sendRiderNotification = async (phoneNumber, order) => {
  if (!phoneNumber) return;
  const formatMoney = (amount) => `${Math.round(amount).toLocaleString()} CFA`;
  let message = `🚚 *NEW ORDER AVAILABLE*\n\n`;
  message += `Order #: ${order.orderNumber}\n`;
  
  if (order.type === 'random') {
    message += `Item: ${order.deliveryData?.itemDescription || 'Parcel'}\n`;
    message += `Pickup: ${order.deliveryData?.pickupAddress || 'Not provided'}\n`;
    message += `Delivery: ${order.deliveryAddress}\n`;
  } else if (order.type === 'business') {
    message += `Items: ${order.items?.length || 0}\n`;
    message += `Delivery: ${order.deliveryAddress}\n`;
  } else if (order.type === 'errand') {
    message += `Errand items: ${order.errandItems?.length || 0}\n`;
    message += `Delivery: ${order.deliveryAddress}\n`;
  } else if (order.type === 'ticket') {
    message += `Ticket to: ${order.ticketData?.destination || 'N/A'}\n`;
    message += `Departure: ${order.ticketData?.departureTime || 'N/A'}\n`;
  } else if (order.type === 'bulk') {
    message += `Bulk order: ${order.bulkData?.parcels?.length || 0} parcels\n`;
    message += `Delivery: ${order.deliveryAddress}\n`;
  }
  
  message += `\nTotal: ${formatMoney(order.total)}\n`;
  message += `\nThank you for choosing AnyWare Logistics.`;
  
  try {
    const response = await axios.post(
      `${process.env.WASENDER_BASE_URL}/send-message`,
      { to: phoneNumber, text: message },
      {
        headers: {
          Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`✅ Rider notification sent to ${phoneNumber} for order ${order.orderNumber}`);
    return response.data;
  } catch (err) {
    console.error(`❌ Failed to send rider notification to ${phoneNumber}:`, err.message);
    throw err;
  }
};

const notifyRiders = async (order) => {
  const riderPhones = await getRiderPhones();
  if (riderPhones.length === 0) return;
  for (const phone of riderPhones) {
    await sendRiderNotification(phone, order);
  }
  console.log(`Notified ${riderPhones.length} riders about order ${order.orderNumber}`);
};

// Notify businesses (full details)
const notifyBusinessesForOrder = async (order) => {
  const businessIds = [...new Set(order.items.map(item => item.business?.toString()).filter(Boolean))];
  if (businessIds.length === 0) return;
  const businesses = await Store.find({ _id: { $in: businessIds } }).select("phone whatsappNumber name");
  for (const biz of businesses) {
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
  }
};

// Notify admin (full details for non‑business orders)
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

module.exports = {
  notifyClient,
  notifyRiders,
  notifyBusinessesForOrder,
  notifyAdmin,
};