const axios = require('axios');
const Redis = require('ioredis');

let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL);
  redisClient.on('error', (err) => console.error('[Redis] Error:', err));
  console.log('[Redis] Connected');
} else {
  console.warn('[Redis] No REDIS_URL – using fallback in‑memory store');
}

const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const WASENDER_BASE_URL = process.env.WASENDER_BASE_URL || 'https://wasenderapi.com/api';
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS) || 300;
const OTP_LENGTH = parseInt(process.env.OTP_LENGTH) || 4;
const RATE_LIMIT_PER_PHONE = parseInt(process.env.RATE_LIMIT_PER_PHONE) || 3;

const memoryStore = new Map();

function generateOTP() {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

async function storeOTP(phoneNumber, code) {
  const key = `otp:${phoneNumber}`;
  const data = JSON.stringify({ code, createdAt: Date.now() });
  if (redisClient) {
    await redisClient.setex(key, OTP_EXPIRY_SECONDS, data);
  } else {
    memoryStore.set(key, { code, expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000 });
  }
}

async function verifyStoredOTP(phoneNumber, userCode) {
  const key = `otp:${phoneNumber}`;
  let record = null;
  if (redisClient) {
    const data = await redisClient.get(key);
    if (data) record = JSON.parse(data);
  } else {
    record = memoryStore.get(key);
  }
  if (!record) return false;
  if (redisClient) {
    const isValid = record.code === userCode;
    if (isValid) await redisClient.del(key);
    return isValid;
  } else {
    if (Date.now() > record.expiresAt) {
      memoryStore.delete(key);
      return false;
    }
    const isValid = record.code === userCode;
    if (isValid) memoryStore.delete(key);
    return isValid;
  }
}

async function checkRateLimit(phoneNumber) {
  const key = `ratelimit:${phoneNumber}`;
  if (redisClient) {
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 600);
    return count <= RATE_LIMIT_PER_PHONE;
  } else {
    if (!memoryStore.has(key)) {
      memoryStore.set(key, { count: 1, resetAt: Date.now() + 600000 });
      return true;
    }
    const record = memoryStore.get(key);
    if (Date.now() > record.resetAt) {
      memoryStore.set(key, { count: 1, resetAt: Date.now() + 600000 });
      return true;
    }
    record.count++;
    if (record.count > RATE_LIMIT_PER_PHONE) return false;
    return true;
  }
}

async function sendOTP(phoneNumber) {
  if (process.env.DISABLE_OTP_VERIFICATION === 'true') {
    console.log('[OTP] Dev mode – skipping send');
    return { success: true, devMode: true };
  }
  if (!WASENDER_API_KEY) throw new Error('WASENDER_API_KEY not configured');

  const allowed = await checkRateLimit(phoneNumber);
  if (!allowed) throw new Error('Too many OTP requests. Please wait 10 minutes.');

  const otpCode = generateOTP();
  await storeOTP(phoneNumber, otpCode);

  const message = `🔐 *Verification Code*\n\nYour code is: *${otpCode}*\n\nThis code expires in 5 minutes. Do not share it with anyone.\n\n_Anyware Group of Companies_`;

  try {
    const response = await axios.post(
      `${WASENDER_BASE_URL}/send-message`,
      { to: phoneNumber, text: message },
      {
        headers: {
          Authorization: `Bearer ${WASENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`[WASender] OTP sent to ${phoneNumber}, response:`, response.data);
    return { success: true, provider: 'wasender' };
  } catch (error) {
    console.error('[WASender] Error:', error.response?.data || error.message);
    throw new Error('Failed to send OTP via WhatsApp');
  }
}

async function verifyOTPCode(phoneNumber, userCode) {
  return verifyStoredOTP(phoneNumber, userCode);
}

/**
 * Send a detailed, professional order notification via WhatsApp.
 * Supports business orders (with item list), errands, tickets, random deliveries, and bulk.
 */
async function sendOrderNotification(phoneNumber, orderDetails) {
  if (!WASENDER_API_KEY) throw new Error('WASENDER_API_KEY not configured');

  const {
    orderNumber,
    status,
    type = 'business',
    items = [],
    errandItems = [],
    ticketData = {},
    deliveryData = {},
    bulkData = {},
    subtotal = 0,
    deliveryFee = 0,
    total = 0,
    deliveryAddress = '',
    pickupAddress = '',
    customerName = '',
    notes = '',
    createdAt = new Date(),
    riderName = '',
  } = orderDetails;

  // Helper to format currency (XAF)
  const formatMoney = (amount) => `${Math.round(amount).toLocaleString()} CFA`;

  // Build header
  let message = `ORDER UPDATE\n\n`;
  message += `Order #: ${orderNumber}\n`;
  message += `Status: ${status.toUpperCase()}\n`;
  message += `Date: ${new Date(createdAt).toLocaleString()}\n`;

  // Customer info (if available)
  if (customerName) message += `Customer: ${customerName}\n`;

  // Order type specific details
  if (type === 'business' && items.length > 0) {
    message += `\n--- ITEMS ---\n`;
    let itemLines = [];
    items.forEach((item, idx) => {
      const line = `${idx+1}. ${item.name} x${item.quantity} — ${formatMoney(item.price)} = ${formatMoney(item.price * item.quantity)}`;
      itemLines.push(line);
    });
    message += itemLines.join('\n');
    message += `\n\nSubtotal: ${formatMoney(subtotal)}`;
    message += `\nDelivery Fee: ${formatMoney(deliveryFee)}`;
    message += `\nTOTAL: ${formatMoney(total)}`;
  }
  else if (type === 'errand' && errandItems.length > 0) {
    message += `\n--- ERRAND ITEMS ---\n`;
    errandItems.forEach((item, idx) => {
      message += `${idx+1}. ${item.name} (${item.quantity}x) — ${formatMoney(item.price * item.quantity)}\n`;
    });
    message += `\nTotal: ${formatMoney(total)}`;
  }
  else if (type === 'ticket') {
    message += `\n--- TICKET DETAILS ---\n`;
    message += `Agency: ${ticketData.busAgency || 'N/A'}\n`;
    message += `From: ${ticketData.departureCity || 'N/A'} → To: ${ticketData.destination || 'N/A'}\n`;
    message += `Departure: ${ticketData.departureTime || 'N/A'}\n`;
    message += `Seat(s): ${ticketData.seatNumber || 'N/A'}\n`;
    message += `Passenger: ${ticketData.passengerName || 'N/A'}\n`;
    message += `Price: ${formatMoney(ticketData.price || 0)}\n`;
    message += `Service Fee: ${formatMoney(deliveryFee)}\n`;
    message += `Total: ${formatMoney(total)}`;
  }
  else if (type === 'random') {
    message += `\n--- DELIVERY DETAILS ---\n`;
    message += `Item: ${deliveryData.itemDescription || 'N/A'}\n`;
    message += `Pickup: ${deliveryData.pickupAddress || pickupAddress || 'N/A'}\n`;
    message += `Delivery: ${deliveryAddress}\n`;
    message += `Sender: ${deliveryData.senderNumber || 'N/A'}\n`;
    message += `Receiver: ${deliveryData.receiverNumber || 'N/A'}\n`;
    message += `Total: ${formatMoney(total)}`;
  }
  else if (type === 'bulk') {
    message += `\n--- BULK ORDER ---\n`;
    message += `Parcels: ${bulkData.parcels ? bulkData.parcels.length : 0}\n`;
    if (bulkData.type === 'pickup') {
      message += `Pickup type: Collect from multiple locations → deliver to ${bulkData.receiverAddress || deliveryAddress}\n`;
    } else {
      message += `Delivery type: Pickup from ${bulkData.pickupAddress || pickupAddress} → deliver to multiple addresses\n`;
    }
    message += `Total: ${formatMoney(total)}`;
  }

  // Delivery address (always show)
  if (deliveryAddress) {
    message += `\n\nDelivery Address:\n${deliveryAddress}`;
  }

  // Additional notes
  if (notes) {
    message += `\n\nNotes: ${notes}`;
  }

  // Rider name (if assigned)
  if (riderName) {
    message += `\n\nAssigned Rider: ${riderName}`;
  }

  // Footer
  message += `\n\nThank you for choosing AnyWare Logistics.`;

  try {
    const response = await axios.post(
      `${WASENDER_BASE_URL}/send-message`,
      { to: phoneNumber, text: message },
      {
        headers: {
          Authorization: `Bearer ${WASENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`[WASender] Order notification sent to ${phoneNumber}, response:`, response.data);
    return response.data;
  } catch (error) {
    console.error('[WASender] Order notification error:', error.response?.data || error.message);
    throw new Error('Failed to send order notification');
  }
}

module.exports = { sendOTP, verifyOTPCode, sendOrderNotification };