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

// Client notification – full details (unchanged)
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

// Rider notification – customised per type
const sendRiderNotification = async (phoneNumber, order) => {
  if (!phoneNumber) return;
  const formatMoney = (amount) => `${Math.round(amount).toLocaleString()} CFA`;
  let message = `*NEW ORDER AVAILABLE*\n\n`;

  const orderType = order.type;
  const deliveryFee = formatMoney(order.deliveryFee);
  const deliveryAddress = order.deliveryAddress;
  const linkPlaceholder = '[Link to app]'; // Replace with actual deep link later

  if (orderType === 'random') {
    const pickup = order.deliveryData?.pickupAddress || 'Not provided';
    const delivery = deliveryAddress;
    message += `Pickup from: ${pickup}\n`;
    message += `Deliver to: ${delivery}\n`;
    message += `Delivery Fee: ${deliveryFee}\n\n`;
    message += `${linkPlaceholder}`;
  }
  else if (orderType === 'business') {
    // Get store name from the first item's business
    let storeName = 'Store';
    if (order.items && order.items.length > 0) {
      const firstItem = order.items[0];
      if (firstItem.product && firstItem.product.business) {
        storeName = firstItem.product.business.name;
      } else if (firstItem.business) {
        const business = await Store.findById(firstItem.business).select('name');
        if (business) storeName = business.name;
      }
    }
    message += `Buy from: ${storeName}\n`;
    message += `Deliver to: ${deliveryAddress}\n`;
    message += `Delivery Fee: ${deliveryFee}\n\n`;
    message += `${linkPlaceholder}`;
  }
  else if (orderType === 'errand') {
    // Determine errand subtype based on errandItems description or notes
    const errandItems = order.errandItems || [];
    const notes = order.notes || '';
    const lowerNotes = notes.toLowerCase();

    // Check for bill payment (electricity or fee)
    if (lowerNotes.includes('electricity') || lowerNotes.includes('eneo')) {
      message += `Pay Bill at: ENEO Head Office\n`;
    }
    else if (lowerNotes.includes('fee') || lowerNotes.includes('bank') || lowerNotes.includes('tuition')) {
      // Extract bank name from notes if possible, else default
      const bankMatch = notes.match(/bank\s+([A-Za-z\s]+)/i);
      const bankName = bankMatch ? bankMatch[1].trim() : 'the bank';
      message += `Pay Bill at: ${bankName}\n`;
    }
    else if (lowerNotes.includes('transcript') || lowerNotes.includes('document')) {
      message += `Apply and collect transcript at: University of Buea\n`;
    }
    else {
      // Default shopping / item list
      message += `Buy the following items:\n`;
      if (errandItems.length > 0) {
        errandItems.forEach(item => {
          message += `- ${item.name} x${item.quantity}\n`;
        });
      } else {
        message += `- ${notes || 'items'}\n`;
      }
      message += `Deliver to: ${deliveryAddress}\n`;
      message += `Delivery Fee: ${deliveryFee}\n\n`;
      message += `${linkPlaceholder}`;
      // Add footer and return early because we already have delivery address
      message += `\n\n_*Thank you for choosing AnyWare Logistics*_`;
      await notifyRecipient(phoneNumber, { orderNumber: order.orderNumber, text: message });
      return;
    }
    // For bill/document errands, add delivery address and fee
    message += `Deliver to: ${deliveryAddress}\n`;
    message += `Delivery Fee: ${deliveryFee}\n\n`;
    message += `${linkPlaceholder}`;
  }
  else if (orderType === 'ticket') {
    const ticketData = order.ticketData || {};
    const agency = ticketData.busAgency || 'Bus Agency';
    message += `Reserve ticket at: ${agency}\n`;
    message += `Deliver Ticket at: ${deliveryAddress}\n`;
    message += `Delivery Fee: ${deliveryFee}\n\n`;
    message += `${linkPlaceholder}`;
  }
  else {
    // Fallback for any other type (bulk, etc.)
    message += `Order #${order.orderNumber}\n`;
    message += `Deliver to: ${deliveryAddress}\n`;
    message += `Delivery Fee: ${deliveryFee}\n\n`;
    message += `${linkPlaceholder}`;
  }

  // Add footer
  message += `\n\n_*Thank you for choosing AnyWare Logistics*_`;

  // Send as a plain text message (not using the template function)
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
    // Fallback to template-based notification
    const orderDetails = {
      orderNumber: order.orderNumber,
      status: "New Order Available",
      type: order.type,
      total: order.total,
      deliveryAddress: order.deliveryAddress,
      customerName: order.user?.name || '',
      createdAt: order.createdAt,
    };
    await notifyRecipient(phoneNumber, orderDetails);
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