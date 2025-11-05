// scripts/fix-business-owners.js
const mongoose = require('mongoose');
const Business = require('./models/Business');
const User = require('./models/User');
require('dotenv').config();

const fixBusinessOwners = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔗 Connected to database');

    // Find businesses without owners or with invalid owners
    const businesses = await Business.find({ 
      $or: [
        { owner: { $exists: false } },
        { owner: null },
        { owner: { $type: 'string' } } // In case owner is stored as string
      ]
    });

    console.log(`🔧 Found ${businesses.length} businesses with owner issues`);

    // Get an admin user to assign as owner
    const adminUser = await User.findOne({ role: 'admin' });
    
    if (!adminUser) {
      console.log('❌ No admin user found');
      return;
    }

    console.log(`👤 Assigning admin as owner: ${adminUser._id}`);

    // Fix each business
    for (const business of businesses) {
      console.log(`🛠️ Fixing business: ${business.name} (${business._id})`);
      
      business.owner = adminUser._id;
      await business.save();
      
      console.log(`✅ Fixed owner for: ${business.name}`);
    }

    console.log('🎉 All businesses fixed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error fixing businesses:', error);
    process.exit(1);
  }
};

fixBusinessOwners();