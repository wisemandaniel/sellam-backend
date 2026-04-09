// services/notificationService.js
const User = require("../models/User");
const Store = require("../models/Store");
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
    // For random deliveries, include pickup address and item description
    pickupAddress: order.deliveryData?.pickupAddress,
    itemDescription: order.deliveryData?.itemDescription,
  };
  for (const phone of riderPhones) {
    await notifyRecipient(phone, orderDetails);
  }
  console.log(`Notified ${riderPhones.length} riders about order ${order.orderNumber}`);
};

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