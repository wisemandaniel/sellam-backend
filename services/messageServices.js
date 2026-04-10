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
 * Send a detailed, professional order notification to the client.
 * Removes order number, date, customer name, notes.
 * Uses status emoji (✅ for confirmed) and underlines section headings.
 */
async function sendOrderNotification(phoneNumber, orderDetails) {
  if (!WASENDER_API_KEY) throw new Error('WASENDER_API_KEY not configured');

  const {
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
  } = orderDetails;

  const formatMoney = (amount) => `${Math.round(amount).toLocaleString()} CFA`;

  // Build header with status
  let message = '';
  if (status === 'Confirmed') {
    message += `✅ *ORDER CONFIRMED*\n\n`;
  } else if (status === 'Delivered') {
    message += `📦 *ORDER DELIVERED*\n\n`;
  } else if (status === 'Accepted') {
    message += `🛵 *ORDER ACCEPTED*\n\n`;
  } else if (status === 'Picked Up') {
    message += `📦 *ORDER PICKED UP*\n\n`;
  } else {
    message += `*ORDER UPDATE*\n\n`;
  }

  // ========== BUSINESS ORDER ==========
  if (type === 'business' && items.length > 0) {
    message += `_ITEMS_\n`;  // underlined
    items.forEach((item, idx) => {
      const lineTotal = item.price * item.quantity;
      message += `${idx+1}. ${item.name} x${item.quantity} — ${formatMoney(item.price)} = ${formatMoney(lineTotal)}\n`;
    });
    message += `\nSubtotal: ${formatMoney(subtotal)}`;
    message += `\nDelivery Fee: ${formatMoney(deliveryFee)}`;
    message += `\n*TOTAL: ${formatMoney(total)}*\n`;
  }

  // ========== ERRAND ORDER ==========
  else if (type === 'errand' && errandItems.length > 0) {
    message += `_ITEMS_\n`;
    errandItems.forEach((item, idx) => {
      const lineTotal = item.price * item.quantity;
      message += `${idx+1}. ${item.name} x${item.quantity} — ${formatMoney(item.price)} = ${formatMoney(lineTotal)}\n`;
    });
    message += `\nTotal: ${formatMoney(total)}\n`;
  }

  // ========== TICKET ORDER ==========
  else if (type === 'ticket') {
    message += `_TICKET DETAILS_\n`;
    message += `Agency: ${ticketData.busAgency || 'N/A'}\n`;
    message += `From: ${ticketData.departureCity || 'N/A'} → To: ${ticketData.destination || 'N/A'}\n`;
    message += `Departure: ${ticketData.departureTime ? new Date(ticketData.departureTime).toLocaleString() : 'N/A'}\n`;
    message += `Seat(s): ${ticketData.seatNumber || 'N/A'}\n`;
    message += `Price: ${formatMoney(ticketData.price || 0)}\n`;
    message += `Service Fee: ${formatMoney(deliveryFee)}\n`;
    message += `*TOTAL: ${formatMoney(total)}*\n`;
  }

  // ========== RANDOM DELIVERY ==========
  else if (type === 'random') {
    message += `_DELIVERY DETAILS_\n`;
    message += `Item: ${deliveryData.itemDescription || 'N/A'}\n`;
    message += `Pickup: ${deliveryData.pickupAddress || pickupAddress || 'N/A'}\n`;
    message += `Delivery: ${deliveryAddress}\n`;
    message += `Total: ${formatMoney(total)}\n`;
  }

  // ========== BULK ORDER ==========
  else if (type === 'bulk') {
    message += `_BULK ORDER_\n`;
    message += `Parcels: ${bulkData.parcels ? bulkData.parcels.length : 0}\n`;
    if (bulkData.type === 'pickup') {
      message += `Pickup type: Collect from multiple locations → deliver to ${bulkData.receiverAddress || deliveryAddress}\n`;
    } else {
      message += `Delivery type: Pickup from ${bulkData.pickupAddress || pickupAddress} → deliver to multiple addresses\n`;
    }
    message += `Total: ${formatMoney(total)}\n`;
  }

  // Always show delivery address
  if (deliveryAddress) {
    message += `\n*Delivery Address:*\n${deliveryAddress}`;
  }

  // Footer
  message += `\n\n_*Thank you for choosing AnyWare Logistics*_`;

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