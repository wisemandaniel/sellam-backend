const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const createAdminUser = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to database');

    // Check if admin already exists
    const adminExists = await User.findOne({ role: 'admin', email: 'admin@fooddelivery.com' });
    
    if (adminExists) {
      console.log('ℹ️  Admin user already exists');
      console.log(`Email: ${adminExists.email}`);
      console.log(`Role: ${adminExists.role}`);
      process.exit(0);
    }

    // Create admin user
    const adminUser = await User.create({
      name: 'System Administrator',
      email: 'admin@fooddelivery.com',
      password: 'admin123', // CHANGE THIS IN PRODUCTION!
      phone: '+237600000000',
      role: 'admin',
      isActive: 'true',
      phoneVerified: true,
      isProfileComplete: true
    });

    console.log('✅ Admin user created successfully!');
    console.log('📋 Admin Details:');
    console.log(`   Name: ${adminUser.name}`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Phone: ${adminUser.phone}`);
    console.log(`   Role: ${adminUser.role}`);
    console.log('⚠️  SECURITY WARNING:');
    console.log('   Change the default password immediately after first login!');
    console.log('   Default password: admin123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
};

createAdminUser();