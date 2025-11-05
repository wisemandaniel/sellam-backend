const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a product name'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Please add a description']
  },
  price: {
    type: Number,
    required: [true, 'Please add a price'],
    min: 0
  },
  images: [{
    type: String,
    required: [true, 'Please add at least one image']
  }],
  category: {
    type: String,
    required: [true, 'Please add a category']
  },
  inStock: {
    type: Boolean,
    default: true
  },
  discount: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: false
  },
  business: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  tags: [String],
  featuredImage: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Virtual for discounted price
productSchema.virtual('discountedPrice').get(function() {
  return this.discount > 0 ? this.price * (1 - this.discount / 100) : this.price;
});

// Set featured image to first image if not set
productSchema.pre('save', function(next) {
  if (this.images.length > 0 && !this.featuredImage) {
    this.featuredImage = this.images[0];
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);