const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/database');
const os = require('os');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Get network IP address
const getNetworkIP = () => {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const interface of interfaces[interfaceName]) {
      // Skip internal and non-IPv4 addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
};

const networkIP = getNetworkIP();
const PORT = process.env.PORT || 5000;

// CORS Configuration - Allow requests from ANY origin
app.use(cors());

// Middleware - Increase payload size limit for large images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Routes
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Food Delivery API is working!',
    version: '1.0.0',
    networkAccess: true,
    yourIP: req.ip,
    serverIP: networkIP
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true,
    message: 'Server is running', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    networkIP: networkIP,
    port: PORT
  });

  res.status(200).send('OK');
});

// API Routes
app.use('/api/auth', require('./routes/auth')); 
app.use('/api/stores', require('./routes/stores'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/users', require('./routes/users'));
app.use('/api/cart', require('./routes/carts'));
app.use('/api/agency', require('./routes/agency'));

// Frontend matching routes
app.use('/api/businesses', require('./routes/businesses'));
app.use('/api/riders', require('./routes/riders'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use('/api/payment', require('./routes/payment'));
app.use('/api/transaction', require('./routes/transaction'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    networkIP: networkIP
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({ 
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {},
    networkIP: networkIP
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========== SERVER STARTED ==========`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`\n📍 Local Access:`);
  console.log(`   🔗 http://localhost:${PORT}`);
  console.log(`   🔗 http://127.0.0.1:${PORT}`);
  console.log(`\n🌐 Network Access:`);
  console.log(`   🔗 http://${networkIP}:${PORT}`);
  console.log(`\n📊 API Endpoints:`);
  console.log(`   🩺 Health: http://${networkIP}:${PORT}/api/health`);
  console.log(`   🔐 Auth: http://${networkIP}:${PORT}/api/auth`);
  console.log(`   🏪 Businesses: http://${networkIP}:${PORT}/api/businesses`);
  console.log(`   📦 Products: http://${networkIP}:${PORT}/api/products`);
  console.log(`   🚴 Riders: http://${networkIP}:${PORT}/api/riders`);
  console.log(`\n💡 Frontend Configuration:`);
  console.log(`   Update your frontend API_BASE_URL to: http://${networkIP}:${PORT}/api`);
  console.log(`\n=====================================\n`);
});