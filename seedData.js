const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

// Simple connection function
const connectDB = async () => {
  try {
    // Check if MONGODB_URI exists
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI is not defined in .env file');
      process.exit(1);
    }

    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected Successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// Sample data
const sampleStores = [
  {
    name: "Bella Italia Restaurant",
    description: "Authentic Italian cuisine with fresh ingredients",
    image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800",
    category: "Restaurants",
    rating: 4.8,
    reviewCount: 324,
    deliveryTime: "25-35 min",
    deliveryFee: 500, // XAF
    minOrder: 7500, // XAF
    isOpen: true,
    phone: "+237612345678",
    address: "123 Main Street, Douala"
  },
  {
    name: "Fresh Market Groceries",
    description: "Your daily groceries delivered fresh",
    image: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800",
    category: "Groceries",
    rating: 4.6,
    reviewCount: 892,
    deliveryTime: "15-25 min",
    deliveryFee: 300, // XAF
    minOrder: 5000, // XAF
    isOpen: true,
    phone: "+237612345679",
    address: "456 Market Road, Yaoundé"
  }
];

const seedDatabase = async () => {
  try {
    // Connect to database
    await connectDB();

    // Import models
    const Store = require('./models/Store');
    const Product = require('./models/Product');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await Store.deleteMany();
    await Product.deleteMany();
    
    // Create stores
    console.log('🏪 Creating stores...');
    const createdStores = await Store.insertMany(sampleStores);
    console.log(`✅ Created ${createdStores.length} stores`);

    // Create sample products
    const sampleProducts = [
      {
        name: "Margherita Pizza",
        description: "Classic pizza with tomato sauce, mozzarella, and fresh basil",
        price: 4500, // XAF
        image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800",
        category: "Main Course",
        inStock: true,
        store: createdStores[0]._id
      },
      {
        name: "Fresh Organic Apples",
        description: "Crisp and sweet organic apples, 1kg",
        price: 1500, // XAF
        image: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=800",
        category: "Fruits",
        inStock: true,
        store: createdStores[1]._id
      }
    ];

    console.log('📦 Creating products...');
    await Product.insertMany(sampleProducts);
    console.log('✅ Created products');

    console.log('🎉 Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
};

// Run the seed function
seedDatabase();