// const User = require('../models/User');
// const Account = require('../models/Account');
// const twilio = require('twilio');

// // Initialize Twilio client
// const twilioClient = twilio(
//   process.env.TWILIO_ACCOUNT_SID,
//   process.env.TWILIO_AUTH_TOKEN
// );

// // Add debugging for model imports
// console.log('📦 User model:', User ? 'Loaded successfully' : 'FAILED to load');
// console.log('📦 Account model:', Account ? 'Loaded successfully' : 'FAILED to load');

// // DEVELOPMENT FLAG - Set to true to disable OTP verification
// const DISABLE_OTP_VERIFICATION = true;

// const formatPhoneNumber = (phone) => {
//   try {
//     // Remove all non-digit characters
//     const cleaned = phone.replace(/\D/g, '');

//     console.log(`📞 Original phone: ${phone}, Cleaned: ${cleaned}`);

//     // Handle different formats
//     if (cleaned.startsWith('237') && cleaned.length === 12) {
//       const formatted = `+${cleaned}`;
//       console.log(`📞 Formatted as: ${formatted}`);
//       return formatted;
//     }

//     if (cleaned.length === 9 && /^[6-9]/.test(cleaned)) {
//       const formatted = `+237${cleaned}`;
//       console.log(`📞 Formatted as: ${formatted}`);
//       return formatted;
//     }

//     if (cleaned.length === 12 && !cleaned.startsWith('+')) {
//       const formatted = `+${cleaned}`;
//       console.log(`📞 Formatted as: ${formatted}`);
//       return formatted;
//     }

//     if (cleaned.startsWith('+') && cleaned.length === 13) {
//       console.log(`📞 Already formatted: ${cleaned}`);
//       return cleaned;
//     }

//     throw new Error(`Invalid phone number format: ${phone} (cleaned: ${cleaned})`);
//   } catch (error) {
//     console.error('❌ PHONE FORMATTING ERROR:', error.message);
//     throw error;
//   }
// };

// // Device verification helper functions
// const shouldSendOTP = (user, deviceId) => {
//   // DEVELOPMENT: Always return false to skip OTP
//   if (DISABLE_OTP_VERIFICATION) {
//     console.log('🚀 DEVELOPMENT MODE: OTP verification disabled');
//     return false;
//   }

//   console.log(`🔍 Checking if OTP required for device: ${deviceId}`);

//   // If user doesn't exist (new registration), send OTP
//   if (!user) {
//     console.log('📱 OTP required: New user registration');
//     return true;
//   }

//   // If user exists but no verified devices, send OTP
//   if (!user.verifiedDevices || user.verifiedDevices.length === 0) {
//     console.log('📱 OTP required: No verified devices for existing user');
//     return true;
//   }

//   // Check if this device is already verified
//   const isDeviceVerified = user.verifiedDevices.some(device =>
//     device.deviceId === deviceId && device.isVerified
//   );

//   if (!isDeviceVerified) {
//     console.log('📱 OTP required: Device not verified');
//     return true;
//   }

//   console.log('✅ OTP not required: Device already verified');
//   return false;
// };

// const addVerifiedDevice = (user, deviceId, deviceInfo = {}) => {
//   if (!user.verifiedDevices) {
//     user.verifiedDevices = [];
//   }

//   // Check if device already exists
//   const existingDeviceIndex = user.verifiedDevices.findIndex(
//     device => device.deviceId === deviceId
//   );

//   const deviceData = {
//     deviceId,
//     isVerified: true,
//     verifiedAt: new Date(),
//     lastLogin: new Date(),
//     deviceType: deviceInfo.deviceType || 'mobile',
//     os: deviceInfo.os || 'unknown',
//     ...deviceInfo
//   };

//   if (existingDeviceIndex !== -1) {
//     // Update existing device
//     user.verifiedDevices[existingDeviceIndex] = {
//       ...user.verifiedDevices[existingDeviceIndex],
//       ...deviceData
//     };
//   } else {
//     // Add new device
//     user.verifiedDevices.push(deviceData);
//   }

//   // Limit to 5 devices per user (remove oldest if exceeded)
//   if (user.verifiedDevices.length > 5) {
//     user.verifiedDevices.sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin));
//     user.verifiedDevices = user.verifiedDevices.slice(0, 5);
//   }
// };

// // Helper function to create or get rider account - WITH ERROR HANDLING
// const createOrGetRiderAccount = async (user) => {
//   try {
//     console.log('💰 CREATING/RETRIEVING RIDER ACCOUNT FOR:', user._id);

//     // Check if Account model is available
//     if (!Account || typeof Account.findOne !== 'function') {
//       console.error('❌ Account model not available');
//       throw new Error('Account model not available');
//     }

//     // Check if account already exists
//     let account = await Account.findOne({ user: user._id });

//     if (!account) {
//       console.log('💰 CREATING NEW RIDER ACCOUNT');

//       // Create account data
//       const accountData = {
//         user: user._id,
//         vehicleType: user.vehicleType || 'motorcycle',
//         status: 'active'
//       };

//       console.log('💰 ACCOUNT DATA:', accountData);

//       // Create new account
//       account = await Account.create(accountData);

//       console.log('✅ RIDER ACCOUNT CREATED:', account.accountNumber);
//     } else {
//       console.log('✅ RIDER ACCOUNT ALREADY EXISTS:', account.accountNumber);
//     }

//     return account;
//   } catch (error) {
//     console.error('❌ ERROR CREATING/RETRIEVING RIDER ACCOUNT:', error);

//     // More detailed error logging
//     if (error.name === 'ValidationError') {
//       console.error('📋 VALIDATION ERRORS:', error.errors);
//     }

//     throw error;
//   }
// };

// // Helper function to get user account information - WITH PROPER ERROR HANDLING
// const getUserAccountInfo = async (user) => {
//   try {
//     console.log('💰 GETTING USER ACCOUNT INFO FOR:', user._id);

//     // Check if Account model is available
//     if (!Account || typeof Account.findOne !== 'function') {
//       console.error('❌ Account model not available in getUserAccountInfo');
//       return null;
//     }

//     // Find account for user
//     const account = await Account.findOne({ user: user._id });

//     if (!account) {
//       console.log('💰 NO ACCOUNT FOUND FOR USER:', user._id);
//       return null;
//     }

//     console.log('✅ ACCOUNT FOUND:', account.accountNumber);

//     // Return ALL account fields from your model
//     return {
//       accountNumber: account.accountNumber,
//       status: account.status,
//       tier: account.tier,
//       vehicleType: account.vehicleType,
//       totalEarnings: account.totalEarnings || 0,
//       availableBalance: account.availableBalance || 0,
//       totalDeliveries: account.totalDeliveries || 0,
//       completedDeliveries: account.completedDeliveries || 0,
//       averageRating: account.averageRating || 0,
//       createdAt: account.createdAt,
//       updatedAt: account.updatedAt
//     };
//   } catch (error) {
//     console.error('❌ ERROR GETTING USER ACCOUNT INFO:', error);
//     console.error('❌ Error details:', error.message);
//     return null;
//   }
// };

// // Helper function to get comprehensive user data for response
// const getComprehensiveUserData = async (user) => {
//   try {
//     console.log('👤 GETTING COMPREHENSIVE USER DATA FOR:', user._id);

//     // Get account information
//     const account = await getUserAccountInfo(user);

//     // Calculate profile completion status
//     const isProfileComplete = !!(user.name && user.phone && user.address && user.vehicleType);

//     // Prepare comprehensive user data
//     const userData = {
//       _id: user._id,
//       name: user.name || '',
//       phone: user.phone || '',
//       email: user.email || '',
//       address: user.address || '',
//       profileImage: user.profileImage || '',
//       role: user.role || 'client',
//       vehicleType: user.vehicleType || 'motorcycle',
//       licensePlate: user.licensePlate || '',
//       rating: account?.averageRating || 4.5,
//       totalDeliveries: account?.totalDeliveries || 0,
//       isProfileComplete: isProfileComplete,
//       isActive: user.isActive !== undefined ? user.isActive : true,
//       verifiedDevices: user.verifiedDevices || [],
//       lastLogin: user.lastLogin || new Date(),
//       createdAt: user.createdAt,
//       updatedAt: user.updatedAt,
//       __v: user.__v || 0
//     };

//     return {
//       user: userData,
//       account: account
//     };
//   } catch (error) {
//     console.error('❌ ERROR GETTING COMPREHENSIVE USER DATA:', error);
//     throw error;
//   }
// };

// // Internal OTP sending function
// const sendOTPInternal = async (phoneNumber) => {
//   try {
//     console.log(`📱 SEND OTP INTERNAL - Starting OTP send to: ${phoneNumber}`);

//     // DEVELOPMENT: Skip actual OTP sending
//     if (DISABLE_OTP_VERIFICATION) {
//       console.log('🚀 DEVELOPMENT MODE: Skipping actual OTP send');
//       return {
//         success: true,
//         verification: { status: 'development_mode' },
//         sid: 'dev-mode-sid'
//       };
//     }

//     // Validate Twilio configuration
//     if (!process.env.TWILIO_ACCOUNT_SID) {
//       throw new Error('Twilio Account SID not configured');
//     }

//     if (!process.env.TWILIO_AUTH_TOKEN) {
//       throw new Error('Twilio Auth Token not configured');
//     }

//     if (!process.env.TWILIO_VERIFY_SERVICE_SID) {
//       throw new Error('Twilio Verify Service SID not configured');
//     }

//     console.log('🔧 Twilio configuration verified');

//     // Additional phone number validation
//     if (!phoneNumber.startsWith('+237')) {
//       throw new Error(`Currently only Cameroonian numbers (+237) are supported: ${phoneNumber}`);
//     }

//     console.log(`✅ Phone number validation passed: ${phoneNumber}`);

//     const verification = await twilioClient.verify.v2
//       .services(process.env.TWILIO_VERIFY_SERVICE_SID)
//       .verifications
//       .create({
//         to: phoneNumber,
//         channel: 'whatsapp'
//       });

//     console.log(`✅ OTP sent successfully via Twilio. Status: ${verification.status}`);

//     return {
//       success: true,
//       verification,
//       sid: verification.sid
//     };
//   } catch (error) {
//     console.error('❌ SEND OTP INTERNAL - Detailed Error:', error);
//     throw new Error(`Failed to send OTP: ${error.message}`);
//   }
// };

// // @desc    Get user profile
// // @route   GET /api/users/profile
// // @access  Private
// const getProfile = async (req, res) => {
//   try {
//     console.log('👤 GET PROFILE - Request received');

//     if (!req.user) {
//       return res.status(401).json({
//         success: false,
//         message: 'Not authenticated'
//       });
//     }

//     const user = await User.findById(req.user.id);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // Get comprehensive user data including account info
//     const comprehensiveData = await getComprehensiveUserData(user);

//     res.json({
//       success: true,
//       data: comprehensiveData.user,
//       account: comprehensiveData.account
//     });
//   } catch (error) {
//     console.error('❌ GET PROFILE - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // @desc    Create or update user profile using phone as identifier
// // @route   POST /api/users
// // @access  Public
// const createOrUpdateUser = async (req, res) => {
//   try {
//     console.log('👤 CREATE/UPDATE USER - Request received');
//     console.log('👤 CREATE/UPDATE USER - Body:', req.body);

//     const { name, phone, address, role = 'client', deviceId, deviceInfo } = req.body;

//     // Validate required fields
//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     if (!name) {
//       return res.status(400).json({
//         success: false,
//         message: 'Name is required'
//       });
//     }

//     if (!address) {
//       return res.status(400).json({
//         success: false,
//         message: 'Address is required'
//       });
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     // Check if user exists by phone number
//     let user = await User.findOne({ phone: formattedPhone });

//     if (user) {
//       console.log('👤 CREATE/UPDATE USER - Updating existing user:', user._id);
//       // Update existing user
//       user = await User.findOneAndUpdate(
//         { phone: formattedPhone },
//         { name, address, role },
//         { new: true, runValidators: true }
//       );
//     } else {
//       console.log('👤 CREATE/UPDATE USER - Creating new user with phone:', formattedPhone);
//       // Create new user
//       user = await User.create({
//         name,
//         phone: formattedPhone,
//         address,
//         role
//       });
//     }

//     // Get comprehensive user data including account info
//     const comprehensiveData = await getComprehensiveUserData(user);

//     // Generate authentication token
//     const token = user.generateAuthToken();
//     console.log('👤 CREATE/UPDATE USER - Token generated for user:', user._id);

//     const response = {
//       success: true,
//       data: comprehensiveData.user,
//       account: comprehensiveData.account,
//       token,
//       message: user.isNew ? 'Profile created successfully' : 'Profile updated successfully'
//     };

//     res.status(200).json(response);
//   } catch (error) {
//     console.error('❌ CREATE/UPDATE USER - Error:', error);

//     // Handle duplicate phone number error
//     if (error.code === 11000 && error.keyPattern && error.keyPattern.phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number already exists'
//       });
//     }

//     res.status(400).json({
//       success: false,
//       message: 'Error saving profile',
//       error: error.message
//     });
//   }
// };

// // @desc    Login user by phone number - automatically creates user if not exists
// // @route   POST /api/users/login
// // @access  Public
// const loginUser = async (req, res) => {
//   try {
//     console.log('👤 LOGIN USER - Request received');
//     console.log('👤 LOGIN USER - Body:', req.body);

//     const { phone, role = 'client', deviceId, deviceInfo = {} } = req.body;

//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     if (!deviceId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Device ID is required'
//       });
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     // Find user by phone number or create new one
//     let user = await User.findOne({ phone: formattedPhone });
//     let isNewUser = false;

//     if (!user) {
//       console.log('👤 LOGIN USER - User not found, creating new user with phone:', formattedPhone);

//       // Create new user with just phone number and role
//       user = await User.create({
//         phone: formattedPhone,
//         role,
//         verifiedDevices: [] // Initialize empty verified devices array
//       });
//       await createOrGetRiderAccount(user);

//       isNewUser = true;
//       console.log('👤 LOGIN USER - New user created:', user._id);
//     }

//     // DEVELOPMENT: Skip OTP check and proceed directly to login
//     if (DISABLE_OTP_VERIFICATION) {
//       console.log('🚀 DEVELOPMENT MODE: Skipping OTP verification, proceeding with direct login');

//       // Update device last login
//       addVerifiedDevice(user, deviceId, deviceInfo);
//       await user.save();
//       await createOrGetRiderAccount(user);

//       // Get comprehensive user data including account info
//       const comprehensiveData = await getComprehensiveUserData(user);

//       // Generate authentication token
//       const token = user.generateAuthToken();

//       const response = {
//         success: true,
//         requiresOtp: false,
//         data: comprehensiveData.user,
//         account: comprehensiveData.account,
//         token,
//         message: 'Login successful (Development Mode - OTP Disabled)'
//       };

//       return res.json(response);
//     }

//     // Check if OTP is required (only runs if DISABLE_OTP_VERIFICATION is false)
//     const otpRequired = shouldSendOTP(user, deviceId);

//     if (otpRequired) {
//       console.log('📱 OTP required, sending verification code...');

//       try {
//         await sendOTPInternal(formattedPhone);

//         // Store pending device verification
//         user.pendingDeviceVerification = {
//           deviceId,
//           deviceInfo,
//           phone: formattedPhone,
//           requestedAt: new Date()
//         };

//         await user.save();

//         return res.json({
//           success: true,
//           requiresOtp: true,
//           message: isNewUser ? 'User created. OTP sent for verification.' : 'OTP sent for device verification.'
//         });

//       } catch (otpError) {
//         console.error('⚠️ OTP sending failed:', otpError.message);

//         // Even if OTP fails, allow login but mark as unverified
//         return res.json({
//           success: true,
//           requiresOtp: true,
//           message: 'Login successful but device verification failed. Please verify your device later.'
//         });
//       }
//     } else {
//       console.log('✅ Device already verified, proceeding with login');

//       // Update device last login
//       addVerifiedDevice(user, deviceId, deviceInfo);
//       await user.save();

//       // Get comprehensive user data including account info
//       const comprehensiveData = await getComprehensiveUserData(user);

//       // Generate authentication token
//       const token = user.generateAuthToken();

//       const response = {
//         success: true,
//         requiresOtp: false,
//         data: comprehensiveData.user,
//         account: comprehensiveData.account,
//         token,
//         message: 'Login successful'
//       };

//       return res.json(response);
//     }

//   } catch (error) {
//     console.error('❌ LOGIN USER - Error:', error);

//     // Handle duplicate phone number error
//     if (error.code === 11000 && error.keyPattern && error.keyPattern.phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number already exists'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // @desc    Verify OTP and register device
// // @route   POST /api/users/verify-otp
// // @access  Public
// const verifyOTP = async (req, res) => {
//   try {
//     const { phone, otp, deviceId, deviceInfo = {} } = req.body;

//     if (!phone || !otp || !deviceId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone, OTP, and device ID are required'
//       });
//     }

//     // DEVELOPMENT: Auto-approve any OTP
//     if (DISABLE_OTP_VERIFICATION) {
//       console.log('🚀 DEVELOPMENT MODE: Auto-approving OTP verification');

//       // Format phone number
//       const formattedPhone = formatPhoneNumber(phone);

//       // Find user
//       const user = await User.findOne({ phone: formattedPhone });
//       if (!user) {
//         return res.status(404).json({
//           success: false,
//           message: 'User not found'
//         });
//       }

//       // Auto-verify device
//       addVerifiedDevice(user, deviceId, deviceInfo);

//       // Clear pending verification
//       user.pendingDeviceVerification = undefined;

//       await user.save();

//       // ✅ CREATE RIDER ACCOUNT IF USER ROLE IS RIDER AND PHONE IS VERIFIED
//       let account = null;
//       if (user.role === 'rider') {
//         account = await createOrGetRiderAccount(user);
//         console.log('💰 RIDER ACCOUNT - Created/retrieved:', account?.accountNumber);
//       } else {
//         // Get existing account for non-rider users
//         account = await getUserAccountInfo(user);
//       }

//       // Get comprehensive user data including account info
//       const comprehensiveData = await getComprehensiveUserData(user);

//       // Generate authentication token
//       const token = user.generateAuthToken();

//       const response = {
//         success: true,
//         message: 'OTP verified and device registered successfully (Development Mode)',
//         data: comprehensiveData.user,
//         account: comprehensiveData.account,
//         token,
//         status: 'approved'
//       };

//       if (user.role === 'rider') {
//         response.message += ' Rider account activated.';
//       }

//       return res.json(response);
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     console.log(`🔐 Verifying OTP for: ${formattedPhone}, device: ${deviceId}`);

//     // Find user
//     const user = await User.findOne({ phone: formattedPhone });
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // Verify OTP via Twilio
//     const verificationCheck = await twilioClient.verify.v2
//       .services(process.env.TWILIO_VERIFY_SERVICE_SID)
//       .verificationChecks
//       .create({
//         to: formattedPhone,
//         code: otp
//       });

//     console.log(`✅ OTP verification status: ${verificationCheck.status}`);

//     if (verificationCheck.status === 'approved') {
//       // OTP verified successfully - register device as verified
//       addVerifiedDevice(user, deviceId, deviceInfo);

//       // Clear pending verification
//       user.pendingDeviceVerification = undefined;

//       await user.save();

//       // ✅ CREATE RIDER ACCOUNT IF USER ROLE IS RIDER AND PHONE IS VERIFIED
//       let account = null;
//       if (user.role === 'rider') {
//         account = await createOrGetRiderAccount(user);
//         console.log('💰 RIDER ACCOUNT - Created/retrieved:', account?.accountNumber);
//       } else {
//         // Get existing account for non-rider users
//         account = await getUserAccountInfo(user);
//       }

//       // Get comprehensive user data including account info
//       const comprehensiveData = await getComprehensiveUserData(user);

//       // Generate authentication token
//       const token = user.generateAuthToken();

//       const response = {
//         success: true,
//         message: 'OTP verified and device registered successfully',
//         data: comprehensiveData.user,
//         account: comprehensiveData.account,
//         token,
//         status: verificationCheck.status
//       };

//       if (user.role === 'rider') {
//         response.message += ' Rider account activated.';
//       }

//       res.json(response);
//     } else {
//       // OTP verification failed
//       res.status(400).json({
//         success: false,
//         message: 'Invalid OTP',
//         status: verificationCheck.status
//       });
//     }

//   } catch (error) {
//     console.error('❌ VERIFY OTP - Error:', error);

//     let errorMessage = 'Failed to verify OTP';

//     if (error.code === 60202) {
//       errorMessage = 'Too many verification attempts';
//     } else if (error.code === 20404) {
//       errorMessage = 'Verification not found';
//     }

//     res.status(500).json({
//       success: false,
//       message: errorMessage,
//       error: error.message
//     });
//   }
// };

// // @desc    Update user profile
// // @route   PUT /api/users/profile
// // @access  Private
// const updateProfile = async (req, res) => {
//   try {
//     console.log('👤 UPDATE PROFILE - Request received');
//     console.log('👤 UPDATE PROFILE - Body:', req.body);
//     console.log('👤 UPDATE PROFILE - User ID:', req.user.id);

//     const { name, phone, address, vehicleType, licensePlate } = req.body;

//     // Validate required fields
//     if (!name || !phone || !address) {
//       return res.status(400).json({
//         success: false,
//         message: 'Name, phone, and address are required'
//       });
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     // Check if phone number is already taken by another user
//     const existingUser = await User.findOne({
//       phone: formattedPhone,
//       _id: { $ne: req.user.id }
//     });

//     if (existingUser) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number already exists'
//       });
//     }

//     // Prepare update data
//     const updateData = {
//       name,
//       phone: formattedPhone,
//       address,
//       vehicleType: vehicleType || 'motorcycle',
//       licensePlate: vehicleType === 'car' ? licensePlate : ''
//     };

//     // Update user
//     const user = await User.findByIdAndUpdate(
//       req.user.id,
//       updateData,
//       {
//         new: true,
//         runValidators: true
//       }
//     );

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // Get comprehensive user data including account info
//     const comprehensiveData = await getComprehensiveUserData(user);

//     console.log('✅ UPDATE PROFILE - Profile updated successfully for user:', user._id);

//     const response = {
//       success: true,
//       data: comprehensiveData.user,
//       account: comprehensiveData.account,
//       message: 'Profile updated successfully'
//     };

//     res.json(response);
//   } catch (error) {
//     console.error('❌ UPDATE PROFILE - Error:', error);

//     // Handle duplicate phone number error
//     if (error.code === 11000 && error.keyPattern && error.keyPattern.phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number already exists'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

// // @desc    Send OTP using Twilio Verify
// // @route   POST /api/users/send-otp
// // @access  Public
// const sendOTP = async (req, res) => {
//   try {
//     const { phone } = req.body;

//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     // DEVELOPMENT: Mock OTP send
//     if (DISABLE_OTP_VERIFICATION) {
//       console.log('🚀 DEVELOPMENT MODE: Mock OTP send');
//       return res.json({
//         success: true,
//         message: 'OTP sent successfully (Development Mode)'
//       });
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     await sendOTPInternal(formattedPhone);

//     res.json({
//       success: true,
//       message: 'OTP sent successfully'
//     });

//   } catch (error) {
//     console.error('❌ SEND OTP - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };

// // @desc    Resend OTP using Twilio Verify
// // @route   POST /api/users/resend-otp
// // @access  Public
// const resendOTP = async (req, res) => {
//   try {
//     const { phone } = req.body;

//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     // DEVELOPMENT: Mock OTP resend
//     if (DISABLE_OTP_VERIFICATION) {
//       console.log('🚀 DEVELOPMENT MODE: Mock OTP resend');
//       return res.json({
//         success: true,
//         message: 'OTP resent successfully (Development Mode)'
//       });
//     }

//     // Format phone number
//     const formattedPhone = formatPhoneNumber(phone);

//     console.log(`🔄 Resending OTP to: ${formattedPhone}`);

//     await sendOTPInternal(formattedPhone);

//     res.json({
//       success: true,
//       message: 'OTP resent successfully'
//     });

//   } catch (error) {
//     console.error('❌ RESEND OTP - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };

// // @desc    Get user's verified devices
// // @route   GET /api/users/devices
// // @access  Private
// const getVerifiedDevices = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.id);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     res.json({
//       success: true,
//       data: user.verifiedDevices || []
//     });
//   } catch (error) {
//     console.error('❌ GET VERIFIED DEVICES - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// // @desc    Remove a verified device
// // @route   DELETE /api/users/devices/:deviceId
// // @access  Private
// const removeDevice = async (req, res) => {
//   try {
//     const { deviceId } = req.params;

//     const user = await User.findById(req.user.id);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     if (user.verifiedDevices) {
//       user.verifiedDevices = user.verifiedDevices.filter(
//         device => device.deviceId !== deviceId
//       );
//       await user.save();
//     }

//     res.json({
//       success: true,
//       message: 'Device removed successfully'
//     });
//   } catch (error) {
//     console.error('❌ REMOVE DEVICE - Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// };

// module.exports = {
//   getProfile,
//   createOrUpdateUser,
//   loginUser,
//   updateProfile,
//   sendOTP,
//   verifyOTP,
//   resendOTP,
//   getVerifiedDevices,
//   removeDevice
// };

/**
 * controllers/userController.js
 * Fully synchronized user controller.
 * - Includes OTP (Twilio or dev-mode)
 * - Device verification support
 * - isActive computed (isProfileComplete && phoneVerified)
 * - Restored sendOTP, resendOTP for routes
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const Account = require("../models/Account");
const twilio = require("twilio");

// --- Twilio Setup ---
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

const DISABLE_OTP_VERIFICATION =
  process.env.DISABLE_OTP_VERIFICATION === "true";

// --- Helpers ---
const formatPhoneNumber = (phone) => {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("237") && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 9 && /^[6-9]/.test(cleaned)) return `+237${cleaned}`;
  if (cleaned.length === 12) return `+${cleaned}`;
  if (phone.startsWith("+") && phone.length >= 8) return phone;
  throw new Error(`Invalid phone number format: ${phone}`);
};

const sendOTPInternal = async (phoneNumber) => {
  if (DISABLE_OTP_VERIFICATION)
    return {
      success: true,
      verification: { status: "development_mode" },
      sid: "dev-mode",
    };
  if (!twilioClient) throw new Error("Twilio not configured");
  if (!process.env.TWILIO_VERIFY_SERVICE_SID)
    throw new Error("Missing TWILIO_VERIFY_SERVICE_SID");

  return await twilioClient.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phoneNumber, channel: "sms" });
};

//[UPDATED LOGIC] Handles both new user creation and returning existing users
const createOrUpdateUser = async (req, res) => {
  try {
    const {
      name,
      phone,
      address,
      role = "client",
      deviceId,
      deviceInfo,
    } = req.body;

    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Phone required" });

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    let isNew = false;

    // --- CREATE OR UPDATE USER ---
    if (user) {
      // Update only the provided fields
      const updateData = {};
      if (name) updateData.name = name;
      if (address) updateData.address = address;
      if (role) updateData.role = role;

      user = await User.findOneAndUpdate(
        { phone: formattedPhone },
        updateData,
        { new: true, runValidators: true }
      );
    } else {
      // Create minimal user with phone; others can be added later
      user = await User.create({
        name: name || "",
        phone: formattedPhone,
        address: address || "",
        role,
      });
      isNew = true;
    }

    // --- SAFELY HANDLE ACCOUNT CREATION ---
    if (user.role === "rider") {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive", // only active if user isActive
          vehicleType: user.vehicleType || "motorcycle",
        });
      }
    }

    // --- ADD DEVICE (if present) ---
    if (deviceId) {
      user.addVerifiedDevice(deviceId, deviceInfo || {});
      await user.save();
    }

    const token = user.generateAuthToken();
    const account = await Account.findOne({ user: user._id });

    return res.status(200).json({
      success: true,
      data: user,
      account: account || null,
      token,
      message: isNew
        ? "Profile created successfully"
        : "Profile updated successfully",
    });
  } catch (err) {
    console.error("createOrUpdateUser error:", err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone already exists" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// [UPDATED LOGIC] Login with device & optional OTP
const loginUser = async (req, res) => {
  try {
    const { phone, role = "client", deviceId, deviceInfo = {} } = req.body;
    if (!phone || !deviceId)
      return res
        .status(400)
        .json({ success: false, message: "Phone and deviceId required" });

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });

    // Ensure user exists
    if (!user) {
      user = await User.create({ phone: formattedPhone, role });
    }

    // Ensure rider account exists (safe version)
    if (role === "rider") {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive",
          vehicleType: user.vehicleType || "motorcycle",
        });
      }
    }

    // OTP handling
    if (DISABLE_OTP_VERIFICATION) {
      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
      await user.save();

      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });

      return res.json({
        success: true,
        requiresOtp: false,
        data: user,
        account,
        token,
        message: "Login successful (dev mode)",
      });
    }

    // OTP required if device unverified
    if (!user.isDeviceVerified(deviceId)) {
      await sendOTPInternal(formattedPhone);
      user.pendingDeviceVerification = {
        deviceId,
        deviceInfo,
        phone: formattedPhone,
        requestedAt: new Date(),
      };
      await user.save();
      return res.json({
        success: true,
        requiresOtp: true,
        message: "OTP sent for verification.",
      });
    } else {
      user.addVerifiedDevice(deviceId, deviceInfo);
      await user.save();
      const token = user.generateAuthToken();
      const account = await Account.findOne({ user: user._id });
      return res.json({
        success: true,
        requiresOtp: false,
        data: user,
        account,
        token,
        message: "Login successful",
      });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err.message || "Server error" });
  }
};

// [UPDATED LOGIC] Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { phone, otp, deviceId, deviceInfo = {} } = req.body;
    if (!phone || !otp || !deviceId)
      return res
        .status(400)
        .json({ success: false, message: "Phone, OTP, and deviceId required" });

    const formattedPhone = formatPhoneNumber(phone);
    let user = await User.findOne({ phone: formattedPhone });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // ======== DEV MODE (OTP DISABLED) ========
    if (DISABLE_OTP_VERIFICATION) {
      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
      await user.save();
    }
    // ======== PRODUCTION MODE (OTP ENABLED) ========
    else {
      if (!twilioClient)
        return res
          .status(500)
          .json({ success: false, message: "Twilio not configured" });

      const check = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: formattedPhone, code: otp });

      if (check.status !== "approved")
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
          status: check.status,
        });

      user.addVerifiedDevice(deviceId, deviceInfo);
      user.phoneVerified = true;
      await user.save();
    }

    // ======== ACCOUNT CREATION SAFEGUARD ========
    // Ensures a rider always has one account, never duplicates
    if (user.role === "rider") {
      let account = await Account.findOne({ user: user._id });
      if (!account) {
        account = await Account.create({
          user: user._id,
          status: user.isActive ? "active" : "inactive",
          vehicleType: user.vehicleType || "motorcycle",
        });
      }
    }

    const token = user.generateAuthToken();
    const account = await Account.findOne({ user: user._id });

    return res.json({
      success: true,
      data: user,
      account,
      token,
      message: DISABLE_OTP_VERIFICATION
        ? "OTP verified (dev mode)"
        : "OTP verified successfully",
    });
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// [PATCHED] sendOTP & resendOTP (route compatibility)
const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Phone required" });
    const formatted = formatPhoneNumber(phone);
    await sendOTPInternal(formatted);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const resendOTP = async (req, res) => sendOTP(req, res);

// [PRESERVED ORIGINAL]
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    const account = await Account.findOne({ user: user._id });
    res.json({ success: true, data: user, account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [UPDATED LOGIC] Ensure profile completeness and Keeps user <-> account state fully consistent
const updateProfile = async (req, res) => {
  try {
    const { name, phone, address, vehicleType, licensePlate } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const formattedPhone = formatPhoneNumber(phone);

    // Prevent duplicate phone numbers
    const existingUser = await User.findOne({
      phone: formattedPhone,
      _id: { $ne: req.user.id },
    });
    if (existingUser)
      return res
        .status(400)
        .json({ success: false, message: "Phone number already exists" });

    const updateData = {
      name: name?.trim() || "",
      phone: formattedPhone,
      address: address?.trim() || "",
      vehicleType: vehicleType || "motorcycle",
      licensePlate: vehicleType === "car" ? licensePlate || "" : "",
    };

    let user = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // Recompute completeness and active status
    user.checkProfileComplete();
    user.computeIsActive();
    await user.save(); // triggers post-save hook to sync account

    // Manually ensure account sync (safety double-check)
    let account = await Account.findOne({ user: user._id });

    if (account) {
      account.status = user.isActive ? "active" : "inactive";
      await account.save();
    } else if (user.role === "rider") {
      account = await Account.create({
        user: user._id,
        vehicleType: user.vehicleType,
        status: user.isActive ? "active" : "inactive",
      });
    }

    return res.json({
      success: true,
      data: user,
      account: account || null,
      message: "Profile updated successfully",
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number already exists" });
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc    Get user's verified devices
// @route   GET /api/users/devices
// @access  Private
const getVerifiedDevices = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user.verifiedDevices || [],
    });
  } catch (error) {
    console.error("❌ GET VERIFIED DEVICES - Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// @desc    Remove a verified device
// @route   DELETE /api/users/devices/:deviceId
// @access  Private
const removeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.verifiedDevices) {
      user.verifiedDevices = user.verifiedDevices.filter(
        (device) => device.deviceId !== deviceId
      );
      await user.save();
    }

    res.json({
      success: true,
      message: "Device removed successfully",
    });
  } catch (error) {
    console.error("❌ REMOVE DEVICE - Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createOrUpdateUser,
  loginUser,
  verifyOTP,
  getProfile,
  updateProfile,
  sendOTP,
  resendOTP,
  getVerifiedDevices,
  removeDevice,
};
