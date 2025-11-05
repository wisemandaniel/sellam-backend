const Product = require('../models/Product');
const Business = require('../models/Business');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Helper function to upload product image to Supabase
const uploadProductImage = async (file, productId, oldImageUrl = null) => {
  try {
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error('Only JPEG, PNG, WebP, and GIF images are allowed');
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Image size must be less than 5MB');
    }

    // Generate unique filename
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `product-${productId}-${Date.now()}.${fileExtension}`;
    const filePath = fileName;

    console.log('📤 Uploading product image to Supabase:', {
      productId: productId,
      fileName: fileName,
      fileSize: file.size
    });

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('products')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('❌ PRODUCT IMAGE UPLOAD ERROR:', error);
      throw new Error('Error uploading product image to storage: ' + error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('products')
      .getPublicUrl(filePath);

    console.log('✅ Product image uploaded successfully:', publicUrl);

    return publicUrl;
  } catch (error) {
    console.error('❌ UPLOAD PRODUCT IMAGE FUNCTION ERROR:', error);
    throw error;
  }
};

// Helper to delete old images
const deleteProductImages = async (imageUrls) => {
  try {
    if (!imageUrls || imageUrls.length === 0) return;

    const filesToDelete = imageUrls
      .filter(url => url.includes('supabase.co'))
      .map(url => {
        const urlParts = url.split('/');
        return urlParts[urlParts.length - 1];
      });

    if (filesToDelete.length > 0) {
      const { error } = await supabase.storage
        .from('products')
        .remove(filesToDelete);

      if (error) {
        console.warn('⚠️ Could not delete old product images:', error.message);
      } else {
        console.log('🗑️ Deleted old product images:', filesToDelete);
      }
    }
  } catch (error) {
    console.warn('⚠️ Error deleting product images:', error.message);
  }
};

// @desc    Get all products (for frontend)
// @route   GET /api/products
// @access  Public
const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate('business', 'name logo deliveryFee deliveryTime')
      .populate('store', 'name phone');
    
    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    console.error('❌ GET ALL PRODUCTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching products',
      error: error.message 
    });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('business', 'name logo deliveryFee deliveryTime')
      .populate('store', 'name phone');

    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('❌ GET PRODUCT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching product',
      error: error.message 
    });
  }
};

// @desc    Create product with image upload (UPDATED FOR MULTER)
// @route   POST /api/products
// @access  Private
const addProduct = async (req, res) => {
  try {
    console.log('🆕 ADD PRODUCT - Request received');
    console.log('🆕 ADD PRODUCT - Body:', req.body);
    console.log('🆕 ADD PRODUCT - Files (multer format):', req.files);

    const { name, description, price, category, business, discount, inStock, tags } = req.body;

    // Validate required fields
    if (!name || !price || !business) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, price, business'
      });
    }

    // Handle multer file format - files come as array in req.files
    let uploadedFiles = [];
    if (req.files && Array.isArray(req.files)) {
      uploadedFiles = req.files; // Multer format - array of files
    }

    console.log('🆕 ADD PRODUCT - Processed files:', uploadedFiles.length);

    // Validate at least one image is provided
    if (uploadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least one product image'
      });
    }

    // Verify business exists
    const businessExists = await Business.findById(business);
    if (!businessExists) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Create temporary product to get ID for image uploads
    const tempProduct = await Product.create({
      name: name.trim(),
      description: description?.trim() || '',
      price: Number(price),
      images: [], // Will be updated after image upload
      category: category || 'food',
      business: business,
      discount: discount ? Number(discount) : 0,
      inStock: inStock !== 'false',
      tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : []
    });

    // Upload all product images using the uploadedFiles array
    const imageUrls = [];
    try {
      for (const file of uploadedFiles) {
        const imageUrl = await uploadProductImage(file, tempProduct._id);
        imageUrls.push(imageUrl);
      }
    } catch (uploadError) {
      // If image upload fails, delete the temporary product
      await Product.findByIdAndDelete(tempProduct._id);
      throw uploadError;
    }

    // Update product with image URLs
    const product = await Product.findByIdAndUpdate(
      tempProduct._id,
      { 
        images: imageUrls,
        featuredImage: imageUrls[0] // Set first image as featured
      },
      { new: true }
    ).populate('business', 'name logo deliveryFee deliveryTime');

    console.log('✅ PRODUCT CREATED:', product.name, 'with', product.images.length, 'images');

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });

  } catch (error) {
    console.error('❌ ADD PRODUCT ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating product: ' + error.message
    });
  }
};

// @desc    Update product with image upload support (UPDATED FOR MULTER)
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  try {
    console.log('✏️ UPDATE PRODUCT - Request for ID:', req.params.id);
    console.log('✏️ UPDATE PRODUCT - Body:', req.body);
    console.log('✏️ UPDATE PRODUCT - Files (multer format):', req.files);

    // Find product
    let product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const { name, description, price, category, discount, inStock, tags, featuredImage } = req.body;

    // Handle multer file format
    let uploadedFiles = [];
    if (req.files && Array.isArray(req.files)) {
      uploadedFiles = req.files;
    }

    // Build update data
    const updateData = {};
    let hasValidUpdate = false;

    // Handle text field updates
    if (name !== undefined && name !== null && name !== '') {
      updateData.name = name.trim();
      hasValidUpdate = true;
    }

    if (description !== undefined && description !== null) {
      updateData.description = description.trim();
      hasValidUpdate = true;
    }

    if (price !== undefined && price !== null) {
      updateData.price = Number(price);
      hasValidUpdate = true;
    }

    if (category !== undefined && category !== null && category !== '') {
      updateData.category = category;
      hasValidUpdate = true;
    }

    if (discount !== undefined && discount !== null) {
      updateData.discount = Number(discount);
      hasValidUpdate = true;
    }

    if (typeof inStock !== 'undefined' && inStock !== null) {
      updateData.inStock = inStock !== 'false';
      hasValidUpdate = true;
    }

    if (featuredImage !== undefined && featuredImage !== null && featuredImage !== '') {
      updateData.featuredImage = featuredImage;
      hasValidUpdate = true;
    }

    if (tags !== undefined && tags !== null) {
      try {
        const parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (Array.isArray(parsedTags)) {
          updateData.tags = parsedTags;
          hasValidUpdate = true;
        }
      } catch (error) {
        console.warn('⚠️ Invalid tags format:', error.message);
      }
    }

    // Handle new image uploads
    if (uploadedFiles.length > 0) {
      const newImageUrls = [];
      
      try {
        for (const file of uploadedFiles) {
          const imageUrl = await uploadProductImage(file, product._id);
          newImageUrls.push(imageUrl);
        }

        // Combine existing images with new ones, or replace if specified
        const keepExisting = req.body.keepExistingImages === 'true';
        if (keepExisting) {
          updateData.images = [...product.images, ...newImageUrls];
        } else {
          // Delete old images if not keeping them
          await deleteProductImages(product.images);
          updateData.images = newImageUrls;
          
          // Set first new image as featured if not specified
          if (!updateData.featuredImage) {
            updateData.featuredImage = newImageUrls[0];
          }
        }
        
        hasValidUpdate = true;
        console.log('✅ Added', newImageUrls.length, 'new images');
      } catch (uploadError) {
        console.error('❌ Image upload failed:', uploadError.message);
      }
    }

    // Check if we have valid updates
    if (!hasValidUpdate && Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Update product
    product = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('business', 'name logo deliveryFee deliveryTime');

    console.log('✅ PRODUCT UPDATED:', product.name);

    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully',
      updatedFields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('❌ UPDATE PRODUCT ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating product: ' + error.message
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    // Delete product images from storage
    await deleteProductImages(product.images);

    await Product.findByIdAndDelete(req.params.id);

    console.log('✅ PRODUCT DELETED:', product.name);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('❌ DELETE PRODUCT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting product',
      error: error.message 
    });
  }
};

// @desc    Add images to existing product (UPDATED FOR MULTER)
// @route   PUT /api/products/:id/images
// @access  Private
const addProductImages = async (req, res) => {
  try {
    console.log('🖼️ ADD PRODUCT IMAGES - Request for ID:', req.params.id);
    console.log('🖼️ ADD PRODUCT IMAGES - Files (multer format):', req.files);

    // Handle multer file format
    let uploadedFiles = [];
    if (req.files && Array.isArray(req.files)) {
      uploadedFiles = req.files;
    }

    if (uploadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least one image'
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Upload new images
    const newImageUrls = [];
    for (const file of uploadedFiles) {
      const imageUrl = await uploadProductImage(file, product._id);
      newImageUrls.push(imageUrl);
    }

    // Add new images to existing ones
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { 
        $push: { images: { $each: newImageUrls } },
        featuredImage: product.featuredImage || newImageUrls[0]
      },
      { new: true }
    ).populate('business', 'name logo deliveryFee deliveryTime');

    console.log('✅ ADDED IMAGES to product:', product.name, 'Total images:', updatedProduct.images.length);

    res.json({
      success: true,
      data: updatedProduct,
      message: `Added ${newImageUrls.length} images successfully`
    });

  } catch (error) {
    console.error('❌ ADD PRODUCT IMAGES ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding product images: ' + error.message
    });
  }
};

// @desc    Remove specific product image
// @route   DELETE /api/products/:id/images
// @access  Private
const removeProductImage = async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Image URL is required'
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Remove image from array
    const updatedImages = product.images.filter(img => img !== imageUrl);
    
    // Update featured image if it was the removed one
    let updateData = { images: updatedImages };
    if (product.featuredImage === imageUrl && updatedImages.length > 0) {
      updateData.featuredImage = updatedImages[0];
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    // Delete image from storage
    await deleteProductImages([imageUrl]);

    console.log('✅ REMOVED IMAGE from product:', product.name);

    res.json({
      success: true,
      data: updatedProduct,
      message: 'Image removed successfully'
    });

  } catch (error) {
    console.error('❌ REMOVE PRODUCT IMAGE ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing product image: ' + error.message
    });
  }
};

// Keep existing functions for mobile app compatibility
const getProducts = async (req, res) => {
  try {
    const { search, category, store, page = 1, limit = 10 } = req.query;
    
    let query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category && category !== 'all') {
      query.category = category;
    }
    
    if (store) {
      query.store = store;
    }

    const products = await Product.find(query)
      .populate('business', 'name logo deliveryFee deliveryTime')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('❌ GET PRODUCTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching products',
      error: error.message 
    });
  }
};

const getVendorProducts = async (req, res) => {
  try {
    const { category, page = 1, limit = 100 } = req.query;
    const { storeId } = req.params;
    
    if (!storeId) {
      return res.status(400).json({ 
        success: false,
        message: 'Store ID is required' 
      });
    }
    
    let query = { store: storeId };
    
    if (category && category !== 'all') {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('business', 'name logo deliveryFee deliveryTime')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('❌ GET VENDOR PRODUCTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching vendor products',
      error: error.message 
    });
  }
};

module.exports = {
  // Frontend-compatible functions
  getAllProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
  addProductImages,
  removeProductImage,
  
  // Original functions for mobile app
  getProducts,
  getVendorProducts,
  createProduct: addProduct
};