// const Order = require('../models/Order');
// const Product = require('../models/Product');
// const Store = require('../models/Store');
// const twilio = require('twilio');

// // Initialize Twilio client
// let twilioClient = null;
// if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
//   twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
//   console.log('✅ Twilio client initialized');
// } else {
//   console.log('⚠️ Twilio not configured - WhatsApp templates disabled');
// }

// // Generate order number
// const generateOrderNumber = async () => {
//   const count = await Order.countDocuments();
//   return `ORD${Date.now()}${count + 1}`;
// };

// // Helper function to format price
// const formatPrice = (price) => {
//   return `XAF ${Math.round(price).toLocaleString()}`;
// };

// // ================================
// // WHATSAPP TEMPLATE FUNCTIONALITY
// // ================================

// // Template 1: Order Notification (5 variables - PRIVACY COMPLIANT)
// const sendWhatsAppTemplate = async (order, storeIds) => {
//   if (!twilioClient || !process.env.WHATSAPP_TEMPLATE_SID) {
//     console.log('⚠️ WhatsApp templates not configured');
//     return { success: false, message: 'WhatsApp templates not configured' };
//   }

//   try {
//     console.log('📱 Sending WhatsApp template notifications...');

//     const stores = await Store.find({ _id: { $in: storeIds } }).select('name phone whatsappNumber');
//     let sentCount = 0;

//     for (const store of stores) {
//       const storePhone = store.whatsappNumber || store.phone;
//       if (!storePhone) {
//         console.log(`❌ No phone number for ${store.name}`);
//         continue;
//       }

//       const storeItems = order.items.filter(item =>
//         item.store && item.store._id && item.store._id.toString() === store._id.toString()
//       );

//       if (storeItems.length === 0) {
//         console.log(`❌ No items for ${store.name}`);
//         continue;
//       }

//       // Format items list
//       const itemsList = storeItems.map(item =>
//         `${item.quantity}x ${item.product.name}`
//       ).join(', ');

//       const storeSubtotal = storeItems.reduce((sum, item) =>
//         sum + (item.price * item.quantity), 0
//       );

//       // Template variables (NO CUSTOMER PHONE - Privacy compliant)
//       const contentVariables = {
//         1: order.orderNumber,                                      // Order number
//         2: order.user?.name || 'Customer',                        // Customer name (no phone)
//         3: itemsList,                                             // Items list
//         4: formatPrice(storeSubtotal),                           // Total amount
//         5: order.deliveryAddress                                  // Delivery address
//       };

//       try {
//         let formattedPhone = storePhone.replace(/\D/g, '');
//         if (!formattedPhone.startsWith('237') && formattedPhone.length === 9) {
//           formattedPhone = '237' + formattedPhone;
//         }

//         const result = await twilioClient.messages.create({
//           contentSid: process.env.WHATSAPP_TEMPLATE_SID,
//           from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
//           to: `whatsapp:+${formattedPhone}`,
//           contentVariables: JSON.stringify(contentVariables)
//         });

//         console.log(`✅ Template sent to ${store.name}`);
//         console.log(`   📞 ${storePhone} | Status: ${result.status}`);
//         sentCount++;

//       } catch (twilioError) {
//         console.error(`❌ Failed to send template to ${store.name}:`, twilioError.message);

//         if (twilioError.code === 63016) {
//           console.log('💡 Template not approved or outside 24-hour window');
//         }
//       }
//     }

//     return {
//       success: sentCount > 0,
//       sentCount,
//       totalStores: stores.length,
//       message: `WhatsApp templates sent to ${sentCount}/${stores.length} stores`
//     };

//   } catch (error) {
//     console.error('🚨 WhatsApp template error:', error);
//     return { success: false, error: error.message };
//   }
// };

// // WhatsApp URL fallback (when templates fail)
// const generateWhatsAppURLs = async (order, storeIds) => {
//   console.log('\n🔗 ========== WHATSAPP URL NOTIFICATIONS ==========');
//   console.log('📱 PRIVACY: Customer phone numbers excluded');
//   console.log('💡 INSTRUCTIONS: Click URLs to send manually');
//   console.log('====================================================\n');

//   const stores = await Store.find({ _id: { $in: storeIds } }).select('name phone whatsappNumber');
//   let urlCount = 0;

//   stores.forEach((store, index) => {
//     const storePhone = store.whatsappNumber || store.phone;
//     if (!storePhone) {
//       console.log(`❌ ${index + 1}. ${store.name}: No phone number`);
//       return;
//     }

//     const storeItems = order.items.filter(item =>
//       item.store && item.store._id && item.store._id.toString() === store._id.toString()
//     );

//     if (storeItems.length === 0) {
//       console.log(`❌ ${index + 1}. ${store.name}: No items`);
//       return;
//     }

//     // Format items with prices
//     const itemsList = storeItems.map(item =>
//       `${item.quantity}x ${item.product.name} - ${formatPrice(item.price * item.quantity)}`
//     ).join('%0A');

//     const storeSubtotal = storeItems.reduce((sum, item) =>
//       sum + (item.price * item.quantity), 0
//     );

//     // Message WITHOUT customer phone (Privacy compliant)
//     const message =
//       `NEW ORDER RECEIVED%0A%0A` +
//       `Order Number: ${order.orderNumber}%0A` +
//       `Customer Name: ${order.user?.name || 'Customer'}%0A%0A` +
//       `YOUR ITEMS:%0A${itemsList}%0A%0A` +
//       `Store Subtotal: ${formatPrice(storeSubtotal)}%0A%0A` +
//       `Delivery Address: ${order.deliveryAddress}%0A%0A` +
//       `Order Notes: ${order.notes || 'No special instructions'}%0A%0A` +
//       `Please confirm receipt and preparation time.`;

//     const formattedPhone = storePhone.replace(/\D/g, '');
//     const whatsappUrl = `https://wa.me/${formattedPhone}?text=${message}`;

//     console.log(`✅ ${index + 1}. ${store.name}`);
//     console.log(`   📞 Store: ${storePhone}`);
//     console.log(`   👤 Customer: ${order.user?.name || 'Customer'} (phone protected)`);
//     console.log(`   📦 ${storeItems.length} item(s) - ${formatPrice(storeSubtotal)}`);
//     console.log(`   🔗 ${whatsappUrl}`);
//     console.log('');

//     urlCount++;
//   });

//   console.log('====================================================');
//   console.log(`📊 SUMMARY: ${urlCount} WhatsApp URL(s) generated`);
//   console.log('✅ Privacy: Customer phone numbers protected');
//   console.log('====================================================\n');

//   return urlCount;
// };

// // Hybrid notification system (templates + fallback)
// const sendStoreNotifications = async (order, storeIds) => {
//   console.log('\n🎯 ========== STORE NOTIFICATIONS ==========');

//   // Try templates first
//   const templateResult = await sendWhatsAppTemplate(order, storeIds);

//   if (!templateResult.success || templateResult.sentCount === 0) {
//     console.log('🔄 Falling back to WhatsApp URLs...');
//     const urlCount = await generateWhatsAppURLs(order, storeIds);
//     return {
//       method: 'urls',
//       count: urlCount,
//       message: `Generated ${urlCount} WhatsApp URLs for manual sending`
//     };
//   }

//   return {
//     method: 'templates',
//     count: templateResult.sentCount,
//     message: templateResult.message
//   };
// };

// // ================================
// // ORDER STATUS MANAGEMENT
// // ================================

// // Accept delivery - Optimized with transaction and validation
// const acceptDelivery = async (req, res) => {
//   const session = await Order.startSession();
//   session.startTransaction();

//   try {
//     const { orderId } = req.params;
//     const riderId = req.user._id;

//     console.log(`🚀 Rider ${riderId} attempting to accept order ${orderId}`);

//     // Validate input
//     if (!orderId) {
//       await session.abortTransaction();
//       return res.status(400).json({
//         success: false,
//         message: 'Order ID is required'
//       });
//     }

//     // Find and update order in one atomic operation
//     const order = await Order.findOneAndUpdate(
//       {
//         _id: orderId,
//         status: 'pending' // Only allow accepting pending orders
//       },
//       {
//         status: 'accepted',
//         rider: riderId,
//         acceptedAt: new Date(),
//         $inc: { __v: 1 } // Optimistic locking
//       },
//       {
//         new: true,
//         session,
//         runValidators: true
//       }
//     ).populate('user', 'name phone')
//      .populate('items.product', 'name image price')
//      .populate('items.store', 'name address deliveryTime coordinates phone');

//     if (!order) {
//       await session.abortTransaction();
//       console.log(`❌ Order ${orderId} not found or already taken`);
//       return res.status(404).json({
//         success: false,
//         message: 'Order not found or already accepted by another rider'
//       });
//     }

//     await session.commitTransaction();
//     console.log(`✅ Order ${orderId} successfully accepted by rider ${riderId}`);

//     // Format response
//     const responseData = {
//       _id: order._id,
//       orderNumber: order.orderNumber,
//       status: order.status,
//       total: order.total,
//       deliveryFee: order.deliveryFee,
//       customer: {
//         name: order.user?.name || 'Customer',
//         phone: order.user?.phone || order.phone
//       },
//       items: order.items.map(item => ({
//         name: item.product?.name || 'Product not found',
//         image: item.product?.image || '',
//         price: item.price,
//         quantity: item.quantity,
//         store: {
//           name: item.store?.name || 'Store not found',
//           address: item.store?.address || '',
//           phone: item.store?.phone || '',
//           deliveryTime: item.store?.deliveryTime || 'N/A',
//           coordinates: item.store?.coordinates || null
//         }
//       })),
//       deliveryAddress: order.deliveryAddress,
//       acceptedAt: order.acceptedAt,
//       createdAt: order.createdAt
//     };

//     res.json({
//       success: true,
//       data: responseData,
//       message: 'Delivery accepted successfully!'
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     console.error('❌ ACCEPT DELIVERY - Error:', error);

//     if (error.name === 'CastError') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid order ID'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Failed to accept delivery',
//       error: error.message
//     });
//   } finally {
//     session.endSession();
//   }
// };

// // Reject delivery - Optimized with atomic update
// const rejectDelivery = async (req, res) => {
//   try {
//     const { orderId } = req.params;
//     const riderId = req.user._id;

//     console.log(`🚫 Rider ${riderId} rejecting order ${orderId}`);

//     // Validate input
//     if (!orderId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Order ID is required'
//       });
//     }

//     // Atomic update to reject order
//     const order = await Order.findOneAndUpdate(
//       {
//         _id: orderId,
//         status: 'pending' // Only allow rejecting pending orders
//       },
//       {
//         status: 'rejected',
//         rejectedBy: riderId,
//         rejectedAt: new Date(),
//         $inc: { __v: 1 }
//       },
//       {
//         new: true,
//         runValidators: true
//       }
//     );

//     if (!order) {
//       console.log(`❌ Order ${orderId} not found or not available for rejection`);
//       return res.status(404).json({
//         success: false,
//         message: 'Order not found or cannot be rejected'
//       });
//     }

//     console.log(`✅ Order ${orderId} rejected by rider ${riderId}`);

//     res.json({
//       success: true,
//       data: {
//         orderNumber: order.orderNumber,
//         status: order.status,
//         rejectedAt: order.rejectedAt
//       },
//       message: 'Delivery rejected successfully'
//     });

//   } catch (error) {
//     console.error('❌ REJECT DELIVERY - Error:', error);

//     if (error.name === 'CastError') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid order ID'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject delivery',
//       error: error.message
//     });
//   }
// };

// // Get rider's active deliveries
// const getMyActiveDeliveries = async (req, res) => {
//   try {
//     const riderId = req.user._id;

//     console.log(`📦 Fetching active deliveries for rider ${riderId}`);

//     const activeDeliveries = await Order.find({
//       rider: riderId,
//       status: { $in: ['accepted', 'picked_up'] } // Only active statuses
//     })
//     .populate('user', 'name phone')
//     .populate('items.product', 'name image price')
//     .populate('items.store', 'name address deliveryTime coordinates phone')
//     .select('orderNumber status total deliveryFee items deliveryAddress phone notes createdAt acceptedAt pickedUpAt')
//     .sort({ acceptedAt: -1 }) // Most recent first
//     .lean(); // Faster read-only operation

//     console.log(`✅ Found ${activeDeliveries.length} active deliveries for rider ${riderId}`);

//     // Format response efficiently
//     const formattedDeliveries = activeDeliveries.map(order => ({
//       _id: order._id,
//       orderNumber: order.orderNumber,
//       status: order.status,
//       total: order.total,
//       deliveryFee: order.deliveryFee,
//       customer: {
//         name: order.user?.name || 'Customer',
//         phone: order.user?.phone || order.phone
//       },
//       items: order.items.map(item => ({
//         name: item.product?.name || 'Product not found',
//         image: item.product?.image || '',
//         price: item.price,
//         quantity: item.quantity,
//         store: {
//           name: item.store?.name || 'Store not found',
//           phone: item.store?.phone || '',
//           address: item.store?.address || '',
//           deliveryTime: item.store?.deliveryTime || 'N/A',
//           coordinates: item.store?.coordinates || null
//         }
//       })),
//       deliveryAddress: order.deliveryAddress,
//       phone: order.phone,
//       notes: order.notes || '',
//       acceptedAt: order.acceptedAt,
//       pickedUpAt: order.pickedUpAt,
//       createdAt: order.createdAt
//     }));

//     res.json({
//       success: true,
//       count: formattedDeliveries.length,
//       data: formattedDeliveries,
//       message: `Found ${formattedDeliveries.length} active deliveries`
//     });

//   } catch (error) {
//     console.error('❌ GET ACTIVE DELIVERIES - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch active deliveries',
//       error: error.message
//     });
//   }
// };

// // Update order status (picked_up, delivered, etc.)
// const updateOrderStatus = async (req, res) => {
//   const session = await Order.startSession();
//   session.startTransaction();

//   try {
//     const { orderId } = req.params;
//     const { status } = req.body;
//     const riderId = req.user._id;

//     console.log(`🔄 Rider ${riderId} updating order ${orderId} to status: ${status}`);

//     // Validate input
//     if (!orderId || !status) {
//       await session.abortTransaction();
//       return res.status(400).json({
//         success: false,
//         message: 'Order ID and status are required'
//       });
//     }

//     const validStatuses = ['picked_up', 'delivered', 'cancelled'];
//     if (!validStatuses.includes(status)) {
//       await session.abortTransaction();
//       return res.status(400).json({
//         success: false,
//         message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
//       });
//     }

//     // Prepare update data based on status
//     const updateData = {
//       status,
//       $inc: { __v: 1 }
//     };

//     // Add timestamp based on status
//     if (status === 'picked_up') {
//       updateData.pickedUpAt = new Date();
//     } else if (status === 'delivered') {
//       updateData.deliveredAt = new Date();
//     } else if (status === 'cancelled') {
//       updateData.cancelledAt = new Date();
//     }

//     // Atomic update - ensure rider owns the order
//     const order = await Order.findOneAndUpdate(
//       {
//         _id: orderId,
//         rider: riderId, // Ensure rider owns this order
//         status: { $in: ['accepted', 'picked_up'] } // Only allow from these statuses
//       },
//       updateData,
//       {
//         new: true,
//         session,
//         runValidators: true
//       }
//     ).populate('user', 'name phone')
//      .populate('items.product', 'name image price')
//      .populate('items.store', 'name address phone');

//     if (!order) {
//       await session.abortTransaction();
//       console.log(`❌ Order ${orderId} not found or unauthorized for status update`);
//       return res.status(404).json({
//         success: false,
//         message: 'Order not found or unauthorized for status update'
//       });
//     }

//     await session.commitTransaction();
//     console.log(`✅ Order ${orderId} status updated to ${status} by rider ${riderId}`);

//     res.json({
//       success: true,
//       data: {
//         orderNumber: order.orderNumber,
//         status: order.status,
//         pickedUpAt: order.pickedUpAt,
//         deliveredAt: order.deliveredAt,
//         cancelledAt: order.cancelledAt
//       },
//       message: `Order status updated to ${status} successfully`
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     console.error('❌ UPDATE ORDER STATUS - Error:', error);

//     if (error.name === 'CastError') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid order ID'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Failed to update order status',
//       error: error.message
//     });
//   } finally {
//     session.endSession();
//   }
// };

// // ================================
// // ORDER CONTROLLERS
// // ================================

// // Create new order
// const createOrder = async (req, res) => {
//   try {
//     const { items, deliveryAddress, phone, notes } = req.body;

//     if (!req.user) {
//       return res.status(401).json({
//         success: false,
//         message: 'User not authenticated'
//       });
//     }

//     // Validate required fields
//     if (!items || items.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No items in order'
//       });
//     }

//     if (!deliveryAddress || !phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Delivery address and phone are required'
//       });
//     }

//     // Process items and calculate totals
//     let subtotal = 0;
//     const orderItems = [];
//     const storeDeliveryFees = new Map();
//     const storeIds = new Set();

//     for (const item of items) {
//       const product = await Product.findById(item.product).populate('store');

//       if (!product) {
//         return res.status(404).json({
//           success: false,
//           message: `Product not found: ${item.product}`
//         });
//       }

//       if (!product.inStock) {
//         return res.status(400).json({
//           success: false,
//           message: `${product.name} is out of stock`
//         });
//       }

//       const price = product.discount > 0
//         ? product.price * (1 - product.discount / 100)
//         : product.price;

//       const itemTotal = price * item.quantity;
//       subtotal += itemTotal;

//       const storeId = product.store._id.toString();
//       storeIds.add(storeId);

//       if (!storeDeliveryFees.has(storeId)) {
//         storeDeliveryFees.set(storeId, product.store.deliveryFee);
//       }

//       orderItems.push({
//         product: product._id,
//         store: product.store._id,
//         quantity: item.quantity,
//         price: price
//       });
//     }

//     // Calculate delivery fee (75% of sum of store fees)
//     const totalStoreDeliveryFees = Array.from(storeDeliveryFees.values()).reduce((sum, fee) => sum + fee, 0);
//     const deliveryFee = Math.round(totalStoreDeliveryFees * 0.75);
//     const total = subtotal + deliveryFee;

//     // Generate order number
//     const orderNumber = await generateOrderNumber();

//     // Create order
//     const order = await Order.create({
//       orderNumber,
//       user: req.user._id,
//       items: orderItems,
//       subtotal,
//       deliveryFee,
//       total,
//       deliveryAddress,
//       phone,
//       notes: notes || ''
//     });

//     // Populate order data
//     await order.populate({
//       path: 'items.product',
//       select: 'name image price'
//     });

//     await order.populate({
//       path: 'items.store',
//       select: 'name deliveryTime'
//     });

//     await order.populate({
//       path: 'user',
//       select: 'name phone'
//     });

//     // Send store notifications (non-blocking)
//     const notificationResult = await sendStoreNotifications(order, Array.from(storeIds));

//     // Success response
//     res.status(201).json({
//       success: true,
//       data: {
//         orderNumber: order.orderNumber,
//         status: order.status,
//         total: order.total,
//         deliveryFee: order.deliveryFee,
//         subtotal: order.subtotal,
//         items: order.items.map(item => ({
//           name: item.product.name,
//           image: item.product.image,
//           price: item.price,
//           quantity: item.quantity,
//           store: item.store.name,
//           deliveryTime: item.store.deliveryTime
//         })),
//         deliveryAddress: order.deliveryAddress,
//         phone: order.phone,
//         notes: order.notes,
//         createdAt: order.createdAt
//       },
//       notifications: {
//         method: notificationResult.method,
//         count: notificationResult.count,
//         message: notificationResult.message
//       },
//       message: 'Order created successfully!'
//     });

//   } catch (error) {
//     console.error('Order creation error:', error);

//     if (error.code === 11000) {
//       return res.status(400).json({
//         success: false,
//         message: 'Order number conflict. Please try again.'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // Get user orders
// const getMyOrders = async (req, res) => {
//   try {
//     const orders = await Order.find({ user: req.user._id })
//       .populate({
//         path: 'items.product',
//         select: 'name image price'
//       })
//       .populate({
//         path: 'items.store',
//         select: 'name deliveryTime'
//       })
//       .select('orderNumber status total deliveryFee subtotal items deliveryAddress phone notes createdAt')
//       .sort({ createdAt: -1 });

//     const formattedOrders = orders.map(order => ({
//       orderNumber: order.orderNumber,
//       status: order.status,
//       total: order.total,
//       deliveryFee: order.deliveryFee,
//       subtotal: order.subtotal,
//       items: order.items.map(item => ({
//         name: item.product?.name || 'Product not found',
//         image: item.product?.image || '',
//         price: item.price,
//         quantity: item.quantity,
//         store: item.store?.name || 'Store not found',
//         deliveryTime: item.store?.deliveryTime || 'N/A'
//       })),
//       deliveryAddress: order.deliveryAddress,
//       phone: order.phone,
//       notes: order.notes,
//       createdAt: order.createdAt
//     }));

//     res.json({
//       success: true,
//       data: formattedOrders
//     });
//   } catch (error) {
//     console.error('Get orders error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // Get single order
// const getOrder = async (req, res) => {
//   try {
//     const order = await Order.findById(req.params.id)
//       .populate({
//         path: 'items.product',
//         select: 'name image price'
//       })
//       .populate({
//         path: 'items.store',
//         select: 'name deliveryTime phone'
//       })
//       .populate({
//         path: 'user',
//         select: 'name phone'
//       });

//     if (!order) {
//       return res.status(404).json({
//         success: false,
//         message: 'Order not found'
//       });
//     }

//     if (order.user._id.toString() !== req.user._id.toString()) {
//       return res.status(403).json({
//         success: false,
//         message: 'Not authorized'
//       });
//     }

//     const responseData = {
//       orderNumber: order.orderNumber,
//       status: order.status,
//       total: order.total,
//       deliveryFee: order.deliveryFee,
//       subtotal: order.subtotal,
//       items: order.items.map(item => ({
//         name: item.product?.name || 'Product not found',
//         image: item.product?.image || '',
//         price: item.price,
//         quantity: item.quantity,
//         store: item.store?.name || 'Store not found',
//         deliveryTime: item.store?.deliveryTime || 'N/A'
//       })),
//       deliveryAddress: order.deliveryAddress,
//       phone: order.phone,
//       notes: order.notes,
//       createdAt: order.createdAt
//     };

//     res.json({
//       success: true,
//       data: responseData
//     });
//   } catch (error) {
//     console.error('Get order error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // Get all pending orders (for riders/drivers)
// const getPendingOrders = async (req, res) => {
//   try {
//     console.log('📦 Fetching pending orders...');

//     // Get pending orders with detailed population
//     const pendingOrders = await Order.find({ status: 'pending' })
//       .populate({
//         path: 'user',
//         select: 'name phone'
//       })
//       .populate({
//         path: 'items.product',
//         select: 'name image price category'
//       })
//       .populate({
//         path: 'items.store',
//         select: 'name phone address deliveryTime coordinates'
//       })
//       .select('orderNumber status total deliveryFee subtotal items deliveryAddress phone notes createdAt updatedAt')
//       .sort({ createdAt: -1 }); // Newest first

//     console.log(`✅ Found ${pendingOrders.length} pending orders`);

//     // Format the response
//     const formattedOrders = pendingOrders.map(order => ({
//       _id: order._id,
//       orderNumber: order.orderNumber,
//       status: order.status,
//       total: order.total,
//       deliveryFee: order.deliveryFee,
//       subtotal: order.subtotal,
//       customer: {
//         name: order.user?.name || 'Customer',
//         phone: order.user?.phone || order.phone
//       },
//       items: order.items.map(item => ({
//         name: item.product?.name || 'Product not found',
//         image: item.product?.image || '',
//         price: item.price,
//         quantity: item.quantity,
//         store: {
//           name: item.store?.name || 'Store not found',
//           phone: item.store?.phone || '',
//           address: item.store?.address || '',
//           deliveryTime: item.store?.deliveryTime || 'N/A',
//           coordinates: item.store?.coordinates || null
//         }
//       })),
//       deliveryAddress: order.deliveryAddress,
//       phone: order.phone,
//       notes: order.notes || 'No special instructions',
//       createdAt: order.createdAt,
//       updatedAt: order.updatedAt
//     }));

//     res.json({
//       success: true,
//       count: formattedOrders.length,
//       data: formattedOrders,
//       message: `Found ${formattedOrders.length} pending orders`
//     });

//   } catch (error) {
//     console.error('❌ Get pending orders error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch pending orders',
//       error: error.message
//     });
//   }
// };

// module.exports = {
//   createOrder,
//   getMyOrders,
//   getOrder,
//   getPendingOrders,
//   acceptDelivery,
//   rejectDelivery,
//   getMyActiveDeliveries,
//   updateOrderStatus
// };

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
// WHATSAPP TEMPLATE FUNCTIONALITY
// ================================

//Template 1: Order Notification (5 variables - PRIVACY COMPLIANT)
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

// ================================
// ORDER STATUS MANAGEMENT
// ================================
// Create new order
const createOrder = async (req, res) => {
  try {
    const { items, deliveryAddress, phone, notes } = req.body;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No items in order",
      });
    }

    if (!deliveryAddress || !phone) {
      return res.status(400).json({
        success: false,
        message: "Delivery address and phone are required",
      });
    }

    // Process items and calculate totals
    let subtotal = 0;
    const orderItems = [];
    const storeDeliveryFees = new Map();
    const storeIds = new Set();

    for (const item of items) {
      const product = await Product.findById(item.product).populate("store");

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.product}`,
        });
      }

      if (!product.inStock) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is out of stock`,
        });
      }

      const price =
        product.discount > 0
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

    // Calculate delivery fee (75% of sum of store fees)
    const totalStoreDeliveryFees = Array.from(
      storeDeliveryFees.values()
    ).reduce((sum, fee) => sum + fee, 0);
    const deliveryFee = Math.round(totalStoreDeliveryFees * 0.75);
    const total = subtotal + deliveryFee;

    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Create order
    const order = await Order.create({
      orderNumber,
      user: req.user._id,
      items: orderItems,
      subtotal,
      deliveryFee,
      total,
      deliveryAddress,
      phone,
      notes: notes || "",
    });

    // Populate order data
    await order.populate({
      path: "items.product",
      select: "name image price",
    });

    await order.populate({
      path: "items.store",
      select: "name deliveryTime",
    });

    await order.populate({
      path: "user",
      select: "name phone",
    });

    // Send store notifications (non-blocking)
    const notificationResult = await sendStoreNotifications(
      order,
      Array.from(storeIds)
    );

    // Success response
    res.status(201).json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        deliveryFee: order.deliveryFee,
        subtotal: order.subtotal,
        items: order.items.map((item) => ({
          name: item.product.name,
          image: item.product.image,
          price: item.price,
          quantity: item.quantity,
          store: item.store.name,
          deliveryTime: item.store.deliveryTime,
        })),
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        notes: order.notes,
        createdAt: order.createdAt,
      },
      notifications: {
        method: notificationResult.method,
        count: notificationResult.count,
        message: notificationResult.message,
      },
      message: "Order created successfully!",
    });
  } catch (error) {
    console.error("Order creation error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Order number conflict. Please try again.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// [PATCHED]
const getMyOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user.id }).sort({
    createdAt: -1,
  });
  res.json({ success: true, data: orders });
};

const getOrder = async (req, res) => {
  const order = await Order.findById(req.params.id).populate("rider", "name");
  if (!order)
    return res.status(404).json({ success: false, message: "Order not found" });
  res.json({ success: true, data: order });
};

const getPendingOrders = async (req, res) => {
  const orders = await Order.find({ status: "pending" }).sort({
    createdAt: -1,
  });
  res.json({ success: true, data: orders });
};

// [UPDATED LOGIC] Accept delivery
const acceptDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const riderId = req.user._id;

    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: "pending" },
      { status: "accepted", rider: riderId, acceptedAt: new Date() },
      { new: true }
    );
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found or taken" });

    const account = await Account.findOne({ user: riderId });
    if (account) {
      account.incrementAccepted();
      await account.save();
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PATCHED] Reject delivery
const rejectDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: "pending" },
      { status: "rejected", rejectedAt: new Date(), rejectedBy: req.user.id },
      { new: true }
    );
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyActiveDeliveries = async (req, res) => {
  const riderId = req.user.id;
  const orders = await Order.find({
    rider: riderId,
    status: { $in: ["accepted", "picked_up"] },
  }).sort({ createdAt: -1 });
  res.json({ success: true, data: orders });
};

// [UPDATED LOGIC] Update order status + earnings
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const riderId = req.user.id;

    const validStatuses = ["picked_up", "delivered", "cancelled"];
    if (!validStatuses.includes(status))
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });

    const updateData = { status };
    if (status === "picked_up") updateData.pickedUpAt = new Date();
    if (status === "delivered") updateData.deliveredAt = new Date();
    if (status === "cancelled") updateData.cancelledAt = new Date();

    const order = await Order.findOneAndUpdate(
      { _id: orderId, rider: riderId },
      updateData,
      { new: true }
    );
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    // When delivered, update Account & User
    if (status === "delivered") {
      let account = await Account.findOne({ user: riderId });
      if (!account)
        account = await Account.create({ user: riderId, status: "active" });
      account.updatePerformance(order);
      account.updateEarnings(order);
      account.incrementCompleted();
      await account.calculateRanking();
      await account.save();

      const user = await User.findById(riderId);
      if (user) {
        user.pushDeliveryMeta({
          orderId: order._id,
          orderNumber: order.orderNumber,
          deliveredAt: order.deliveredAt,
          deliveryFee: order.deliveryFee,
          distance: order.distance,
          earnings:
            Number(order.deliveryFee) *
            (Number(process.env.DRIVER_COMMISSION_RATE) || 0.75),
        });
        await user.save();
      }
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  getPendingOrders,
  acceptDelivery,
  rejectDelivery,
  getMyActiveDeliveries,
  updateOrderStatus,
};
