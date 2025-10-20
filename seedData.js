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

// Expanded sample data with more stores
const sampleStores = [
  // Restaurants
  {
    name: "Bella Italia Restaurant",
    description: "Authentic Italian cuisine with fresh ingredients",
    image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800",
    category: "Restaurants",
    rating: 4.8,
    reviewCount: 324,
    deliveryTime: "25-35 min",
    deliveryFee: 500,
    minOrder: 7500,
    isOpen: true,
    phone: "+237612345678",
    address: "123 Main Street, Douala"
  },
  {
    name: "Dragon Palace Chinese",
    description: "Traditional Chinese dishes with modern twist",
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800",
    category: "Restaurants",
    rating: 4.5,
    reviewCount: 287,
    deliveryTime: "30-40 min",
    deliveryFee: 600,
    minOrder: 8000,
    isOpen: true,
    phone: "+237612345679",
    address: "789 China Town, Douala"
  },
  {
    name: "Burger King Yaoundé",
    description: "American-style burgers and fries",
    image: "https://images.unsplash.com/photo-1572802419224-296b0aeee0d9?w=800",
    category: "Fast Food",
    rating: 4.3,
    reviewCount: 512,
    deliveryTime: "20-30 min",
    deliveryFee: 400,
    minOrder: 6000,
    isOpen: true,
    phone: "+237612345680",
    address: "456 Food Court, Yaoundé"
  },
  {
    name: "Le Parisien Bistro",
    description: "French cuisine and pastries",
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800",
    category: "Restaurants",
    rating: 4.7,
    reviewCount: 156,
    deliveryTime: "35-45 min",
    deliveryFee: 700,
    minOrder: 10000,
    isOpen: true,
    phone: "+237612345681",
    address: "321 French Quarter, Douala"
  },

  // Groceries
  {
    name: "Fresh Market Groceries",
    description: "Your daily groceries delivered fresh",
    image: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800",
    category: "Groceries",
    rating: 4.6,
    reviewCount: 892,
    deliveryTime: "15-25 min",
    deliveryFee: 300,
    minOrder: 5000,
    isOpen: true,
    phone: "+237612345682",
    address: "456 Market Road, Yaoundé"
  },
  {
    name: "Organic Heaven",
    description: "100% organic products and health foods",
    image: "https://images.unsplash.com/photo-1542834369-f10ebf06d3e0?w=800",
    category: "Groceries",
    rating: 4.9,
    reviewCount: 234,
    deliveryTime: "20-30 min",
    deliveryFee: 500,
    minOrder: 7000,
    isOpen: true,
    phone: "+237612345683",
    address: "789 Health Street, Douala"
  },
  {
    name: "Quick Mart",
    description: "24/7 convenience store",
    image: "https://images.unsplash.com/photo-1604719312566-8912e2217be7?w=800",
    category: "Convenience",
    rating: 4.2,
    reviewCount: 678,
    deliveryTime: "10-20 min",
    deliveryFee: 200,
    minOrder: 3000,
    isOpen: true,
    phone: "+237612345684",
    address: "123 Quick Lane, Yaoundé"
  },

  // Pharmacies
  {
    name: "Health Plus Pharmacy",
    description: "Your trusted pharmacy partner",
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800",
    category: "Pharmacy",
    rating: 4.8,
    reviewCount: 445,
    deliveryTime: "15-25 min",
    deliveryFee: 400,
    minOrder: 0,
    isOpen: true,
    phone: "+237612345685",
    address: "555 Health Avenue, Douala"
  },
  {
    name: "MediCare Express",
    description: "Fast medical supplies delivery",
    image: "https://images.unsplash.com/photo-1516549655669-df6654e447ba?w=800",
    category: "Pharmacy",
    rating: 4.6,
    reviewCount: 321,
    deliveryTime: "20-30 min",
    deliveryFee: 350,
    minOrder: 0,
    isOpen: true,
    phone: "+237612345686",
    address: "777 Care Road, Yaoundé"
  },

  // Electronics
  {
    name: "Tech World Electronics",
    description: "Latest gadgets and electronics",
    image: "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=800",
    category: "Electronics",
    rating: 4.4,
    reviewCount: 567,
    deliveryTime: "45-60 min",
    deliveryFee: 800,
    minOrder: 15000,
    isOpen: true,
    phone: "+237612345687",
    address: "888 Tech Park, Douala"
  },
  {
    name: "Mobile Zone",
    description: "Smartphones and accessories",
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800",
    category: "Electronics",
    rating: 4.3,
    reviewCount: 398,
    deliveryTime: "40-55 min",
    deliveryFee: 600,
    minOrder: 12000,
    isOpen: true,
    phone: "+237612345688",
    address: "222 Mobile Street, Yaoundé"
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

    // Create expanded sample products for each store
    const sampleProducts = [
      // Bella Italia Restaurant Products
      {
        name: "Margherita Pizza",
        description: "Classic pizza with tomato sauce, mozzarella, and fresh basil",
        price: 4500,
        image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800",
        category: "Pizza",
        inStock: true,
        discount: 0,
        store: createdStores[0]._id,
        tags: ["vegetarian", "italian"]
      },
      {
        name: "Spaghetti Carbonara",
        description: "Creamy pasta with bacon and parmesan cheese",
        price: 3800,
        image: "https://images.unsplash.com/photo-1621996346565-e3dbc353d2e5?w=800",
        category: "Pasta",
        inStock: true,
        discount: 10,
        store: createdStores[0]._id,
        tags: ["pasta", "creamy"]
      },
      {
        name: "Tiramisu",
        description: "Classic Italian dessert with coffee and mascarpone",
        price: 2500,
        image: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800",
        category: "Dessert",
        inStock: true,
        discount: 0,
        store: createdStores[0]._id,
        tags: ["dessert", "coffee"]
      },

      // Dragon Palace Chinese Products
      {
        name: "Kung Pao Chicken",
        description: "Spicy stir-fried chicken with peanuts and vegetables",
        price: 5200,
        image: "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800",
        category: "Main Course",
        inStock: true,
        discount: 5,
        store: createdStores[1]._id,
        tags: ["spicy", "chicken"]
      },
      {
        name: "Vegetable Spring Rolls",
        description: "Crispy spring rolls with fresh vegetables",
        price: 1800,
        image: "https://images.unsplash.com/photo-1589606663740-33e5c49b46f7?w=800",
        category: "Appetizer",
        inStock: true,
        discount: 0,
        store: createdStores[1]._id,
        tags: ["vegetarian", "crispy"]
      },

      // Burger King Yaoundé Products
      {
        name: "Whopper Burger",
        description: "Signature flame-grilled beef burger with fresh toppings",
        price: 3500,
        image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800",
        category: "Burgers",
        inStock: true,
        discount: 15,
        store: createdStores[2]._id,
        tags: ["beef", "popular"]
      },
      {
        name: "French Fries",
        description: "Golden crispy fries with ketchup",
        price: 1200,
        image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800",
        category: "Sides",
        inStock: true,
        discount: 0,
        store: createdStores[2]._id,
        tags: ["side", "crispy"]
      },

      // Le Parisien Bistro Products
      {
        name: "Croissant",
        description: "Freshly baked butter croissant",
        price: 800,
        image: "https://images.unsplash.com/photo-1555507038-44d78bf15c44?w=800",
        category: "Pastry",
        inStock: true,
        discount: 0,
        store: createdStores[3]._id,
        tags: ["breakfast", "french"]
      },
      {
        name: "Beef Bourguignon",
        description: "Traditional French beef stew in red wine sauce",
        price: 6800,
        image: "https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=800",
        category: "Main Course",
        inStock: true,
        discount: 8,
        store: createdStores[3]._id,
        tags: ["beef", "wine"]
      },

      // Fresh Market Groceries Products
      {
        name: "Fresh Organic Apples",
        description: "Crisp and sweet organic apples, 1kg",
        price: 1500,
        image: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=800",
        category: "Fruits",
        inStock: true,
        discount: 5,
        store: createdStores[4]._id,
        tags: ["organic", "fruit"]
      },
      {
        name: "Whole Wheat Bread",
        description: "Freshly baked whole wheat bread",
        price: 800,
        image: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=800",
        category: "Bakery",
        inStock: true,
        discount: 0,
        store: createdStores[4]._id,
        tags: ["bread", "healthy"]
      },
      {
        name: "Fresh Milk",
        description: "1 liter of fresh pasteurized milk",
        price: 1200,
        image: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=800",
        category: "Dairy",
        inStock: true,
        discount: 0,
        store: createdStores[4]._id,
        tags: ["dairy", "fresh"]
      },

      // Organic Heaven Products
      {
        name: "Organic Avocado",
        description: "Fresh organic avocados, pack of 3",
        price: 2000,
        image: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=800",
        category: "Fruits",
        inStock: true,
        discount: 10,
        store: createdStores[5]._id,
        tags: ["organic", "healthy"]
      },
      {
        name: "Quinoa",
        description: "Organic quinoa, 500g package",
        price: 3500,
        image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800",
        category: "Grains",
        inStock: true,
        discount: 0,
        store: createdStores[5]._id,
        tags: ["organic", "gluten-free"]
      },

      // Quick Mart Products
      {
        name: "Coca Cola",
        description: "330ml can of Coca Cola",
        price: 600,
        image: "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800",
        category: "Beverages",
        inStock: true,
        discount: 0,
        store: createdStores[6]._id,
        tags: ["soda", "cold"]
      },
      {
        name: "Potato Chips",
        description: "Crunchy potato chips, 150g bag",
        price: 800,
        image: "https://images.unsplash.com/photo-1566475954521-ad6c7ac14c36?w=800",
        category: "Snacks",
        inStock: true,
        discount: 15,
        store: createdStores[6]._id,
        tags: ["snack", "crunchy"]
      },

      // Health Plus Pharmacy Products
      {
        name: "Vitamin C Tablets",
        description: "1000mg Vitamin C supplements, 30 tablets",
        price: 4500,
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800",
        category: "Supplements",
        inStock: true,
        discount: 0,
        store: createdStores[7]._id,
        tags: ["vitamin", "immune"]
      },
      {
        name: "Bandages",
        description: "Assorted adhesive bandages, 100 pieces",
        price: 1500,
        image: "https://images.unsplash.com/photo-1584467735871-8db9ac8d0918?w=800",
        category: "First Aid",
        inStock: true,
        discount: 0,
        store: createdStores[7]._id,
        tags: ["first-aid", "essential"]
      },

      // MediCare Express Products
      {
        name: "Pain Relief Tablets",
        description: "Fast-acting pain relief, 24 tablets",
        price: 3200,
        image: "https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=800",
        category: "Medication",
        inStock: true,
        discount: 5,
        store: createdStores[8]._id,
        tags: ["pain-relief", "fast-acting"]
      },

      // Tech World Electronics Products
      {
        name: "Wireless Earbuds",
        description: "Bluetooth 5.0 wireless earbuds with charging case",
        price: 25000,
        image: "https://images.unsplash.com/photo-1590658165737-15a047b8b5e5?w=800",
        category: "Audio",
        inStock: true,
        discount: 20,
        store: createdStores[9]._id,
        tags: ["wireless", "bluetooth"]
      },
      {
        name: "Smartphone Case",
        description: "Protective case for most smartphone models",
        price: 5000,
        image: "https://images.unsplash.com/photo-1556656793-08538906a9f8?w=800",
        category: "Accessories",
        inStock: true,
        discount: 10,
        store: createdStores[9]._id,
        tags: ["protective", "accessory"]
      },

      // Mobile Zone Products
      {
        name: "USB-C Cable",
        description: "Fast charging USB-C cable, 1 meter",
        price: 3500,
        image: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800",
        category: "Accessories",
        inStock: true,
        discount: 0,
        store: createdStores[10]._id,
        tags: ["charging", "cable"]
      },
      {
        name: "Power Bank",
        description: "10000mAh portable power bank",
        price: 18000,
        image: "https://images.unsplash.com/photo-1597764690524-34dfc00f72bc?w=800",
        category: "Accessories",
        inStock: true,
        discount: 15,
        store: createdStores[10]._id,
        tags: ["portable", "charging"]
      }
    ];

    console.log('📦 Creating products...');
    const createdProducts = await Product.insertMany(sampleProducts);
    console.log(`✅ Created ${createdProducts.length} products`);

    console.log('🎉 Database seeded successfully!');
    console.log(`🏪 Total Stores: ${createdStores.length}`);
    console.log(`📦 Total Products: ${createdProducts.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
};

// Run the seed function
seedDatabase();