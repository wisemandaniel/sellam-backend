const mongoose = require("mongoose");
const Business = require('../models/Business');
const Product = require('../models/Product');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Helper function to upload image to Supabase
const uploadToSupabase = async (file, businessId, imageType, oldImageUrl = null) => {
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
    const fileName = `${imageType}-${businessId}-${Date.now()}.${fileExtension}`;
    const filePath = `business-${imageType}s/${fileName}`;

    console.log(`📤 Uploading ${imageType} to Supabase:`, {
      businessId: businessId,
      fileName: fileName,
      fileSize: file.size
    });

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('businesses')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error(`❌ ${imageType.toUpperCase()} UPLOAD ERROR:`, error);
      throw new Error(`Error uploading ${imageType} to storage: ` + error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('businesses')
      .getPublicUrl(filePath);

    console.log(`✅ ${imageType.toUpperCase()} uploaded successfully:`, publicUrl);

    // Delete old image if it exists and is from Supabase
    if (oldImageUrl && oldImageUrl.includes('supabase.co')) {
      try {
        const oldUrlParts = oldImageUrl.split('/');
        const oldFileName = oldUrlParts[oldUrlParts.length - 1];
        const oldFilePath = `business-${imageType}s/${oldFileName}`;
        
        const { error: deleteError } = await supabase.storage
          .from('businesses')
          .remove([oldFilePath]);

        if (deleteError) {
          console.warn(`⚠️ Could not delete old ${imageType}:`, deleteError.message);
        } else {
          console.log(`🗑️ Deleted old ${imageType}:`, oldFilePath);
        }
      } catch (deleteError) {
        console.warn(`⚠️ Error deleting old ${imageType}:`, deleteError.message);
      }
    }

    return publicUrl;
  } catch (error) {
    console.error(`❌ UPLOAD ${imageType.toUpperCase()} FUNCTION ERROR:`, error);
    throw error;
  }
};

// @desc    Get all businesses
// @route   GET /api/businesses
// @access  Public
const getBusinesses = async (req, res) => {
  try {
    const { category, isOpen, search } = req.query;
    
    let filter = {};
    
    if (category) filter.category = category;
    if (isOpen !== undefined) filter.isOpen = isOpen === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const businesses = await Business.find(filter)
      .populate('owner', 'name email phone')
      .select('-__v')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: businesses.length,
      data: businesses
    });
  } catch (error) {
    console.error('❌ GET BUSINESSES ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching businesses' 
    });
  }
};

// @desc    Get single business
// @route   GET /api/businesses/:id
// @access  Public
const getBusiness = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id)
      .populate('owner', 'name email phone profileImage');

    if (!business) {
      return res.status(404).json({ 
        success: false,
        message: 'Business not found' 
      });
    }

    res.json({
      success: true,
      data: business
    });
  } catch (error) {
    console.error('❌ GET BUSINESS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching business' 
    });
  }
};

// @desc    Create business
// @route   POST /api/businesses
// @access  Private
const addBusiness = async (req, res) => {
  try {
    console.log('🏢 ADD BUSINESS - Request received:', req.body);
    console.log('🏢 ADD BUSINESS - Files:', {
      logo: req.files?.logo ? 'Present' : 'Not present',
      coverImage: req.files?.coverImage ? 'Present' : 'Not present'
    });

    const { name, description, address, phone, email, category, deliveryTime, deliveryFee, minOrderAmount, openingHours, tags } = req.body;

    // Validate required fields
    if (!name || !address || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, address, and phone are required'
      });
    }

    // Check if business already exists with same phone
    const existingBusiness = await Business.findOne({ phone: phone.trim() });
    if (existingBusiness) {
      return res.status(400).json({
        success: false,
        message: 'Business with this phone number already exists'
      });
    }

    let logoUrl = '';
    let coverImageUrl = '';

    // Upload logo if provided
    if (req.files?.logo) {
      try {
        const tempBusinessId = new mongoose.Types.ObjectId();
        logoUrl = await uploadToSupabase(req.files.logo[0], tempBusinessId, 'logo');
      } catch (uploadError) {
        console.error('❌ Logo upload failed:', uploadError.message);
      }
    }

    // Upload cover image if provided
    if (req.files?.coverImage) {
      try {
        const tempBusinessId = new mongoose.Types.ObjectId();
        coverImageUrl = await uploadToSupabase(req.files.coverImage[0], tempBusinessId, 'cover');
      } catch (uploadError) {
        console.error('❌ Cover image upload failed:', uploadError.message);
      }
    }

    // Parse opening hours if provided
    let parsedOpeningHours = { opening: '08:00', closing: '22:00' };
    if (openingHours) {
      try {
        parsedOpeningHours = typeof openingHours === 'string' 
          ? JSON.parse(openingHours) 
          : openingHours;
      } catch (error) {
        console.warn('⚠️ Invalid opening hours format, using defaults');
      }
    }

    // Parse tags if provided
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (error) {
        console.warn('⚠️ Invalid tags format');
      }
    }

    // Create business
    const businessData = {
      name: name.trim(),
      description: description?.trim() || '',
      address: address.trim(),
      phone: phone.trim(),
      email: email?.trim() || '',
      owner: req.user.id,
      category: category || 'restaurant',
      logo: logoUrl,
      coverImage: coverImageUrl,
      deliveryTime: deliveryTime || '30-45 min',
      deliveryFee: deliveryFee ? Number(deliveryFee) : 1000,
      minOrderAmount: minOrderAmount ? Number(minOrderAmount) : 0,
      openingHours: parsedOpeningHours,
      tags: parsedTags
    };

    const business = await Business.create(businessData);

    // Update images with actual business ID if they were uploaded with temp ID
    if (logoUrl && logoUrl.includes('supabase.co')) {
      await updateImageWithActualId(logoUrl, business._id, 'logo');
    }
    if (coverImageUrl && coverImageUrl.includes('supabase.co')) {
      await updateImageWithActualId(coverImageUrl, business._id, 'cover');
    }

    const savedBusiness = await Business.findById(business._id)
      .populate('owner', 'name email phone');

    console.log('✅ BUSINESS CREATED:', savedBusiness.name);

    res.status(201).json({
      success: true,
      data: savedBusiness,
      message: 'Business created successfully'
    });

  } catch (error) {
    console.error('❌ ADD BUSINESS ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Business with this phone number already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating business: ' + error.message
    });
  }
};

// Helper function to update image with actual business ID
const updateImageWithActualId = async (imageUrl, businessId, imageType) => {
  try {
    const urlParts = imageUrl.split('/');
    const oldFileName = urlParts[urlParts.length - 1];
    const newFileName = `${imageType}-${businessId}-${Date.now()}.${oldFileName.split('.').pop()}`;
    const newFilePath = `business-${imageType}s/${newFileName}`;

    const { data: copyData, error: copyError } = await supabase.storage
      .from('businesses')
      .copy(`business-${imageType}s/${oldFileName}`, newFilePath);

    if (!copyError) {
      const { data: { publicUrl: newPublicUrl } } = supabase.storage
        .from('businesses')
        .getPublicUrl(newFilePath);

      await Business.findByIdAndUpdate(businessId, { 
        [imageType === 'logo' ? 'logo' : 'coverImage']: newPublicUrl 
      });

      await supabase.storage
        .from('businesses')
        .remove([`business-${imageType}s/${oldFileName}`]);

      console.log(`✅ ${imageType.toUpperCase()} updated with correct business ID`);
    }
  } catch (updateError) {
    console.warn(`⚠️ Could not update ${imageType} with correct business ID:`, updateError.message);
  }
};

// @desc    Update business
// @route   PUT /api/businesses/:id
// @access  Private
const updateBusiness = async (req, res) => {
  try {
    console.log('✏️ UPDATE BUSINESS - Request for ID:', req.params.id);
    console.log('✏️ UPDATE BUSINESS - Body:', req.body);
    console.log('✏️ UPDATE BUSINESS - Files:', {
      logo: req.files?.logo ? 'Present' : 'Not present',
      coverImage: req.files?.coverImage ? 'Present' : 'Not present'
    });

    // Find business
    let business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Check if user owns the business or is admin
    if (business.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this business'
      });
    }

    const { name, description, address, phone, email, category, deliveryTime, deliveryFee, minOrderAmount, openingHours, isOpen, tags } = req.body;

    // Build update data
    const updateData = {};
    let hasValidUpdate = false;

    // Handle text field updates
    if (name !== undefined && name !== null && name !== '') {
      updateData.name = name.trim();
      hasValidUpdate = true;
    }

    if (description !== undefined) updateData.description = description.trim();
    if (address !== undefined && address !== '') {
      updateData.address = address.trim();
      hasValidUpdate = true;
    }
    if (phone !== undefined && phone !== '') {
      updateData.phone = phone.trim();
      hasValidUpdate = true;
    }
    if (email !== undefined) updateData.email = email.trim();
    if (category !== undefined) updateData.category = category;
    if (deliveryTime !== undefined) updateData.deliveryTime = deliveryTime;
    if (deliveryFee !== undefined) updateData.deliveryFee = Number(deliveryFee);
    if (minOrderAmount !== undefined) updateData.minOrderAmount = Number(minOrderAmount);
    if (typeof isOpen !== 'undefined') updateData.isOpen = isOpen;

    if (openingHours) {
      try {
        updateData.openingHours = typeof openingHours === 'string' 
          ? JSON.parse(openingHours) 
          : openingHours;
        hasValidUpdate = true;
      } catch (error) {
        console.warn('⚠️ Invalid opening hours format');
      }
    }

    if (tags) {
      try {
        updateData.tags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        hasValidUpdate = true;
      } catch (error) {
        console.warn('⚠️ Invalid tags format');
      }
    }

    // Handle logo upload
    if (req.files?.logo) {
      try {
        updateData.logo = await uploadToSupabase(req.files.logo[0], business._id, 'logo', business.logo);
        hasValidUpdate = true;
        console.log('✅ Logo updated');
      } catch (uploadError) {
        console.error('❌ Logo upload failed:', uploadError.message);
      }
    }

    // Handle cover image upload
    if (req.files?.coverImage) {
      try {
        updateData.coverImage = await uploadToSupabase(req.files.coverImage[0], business._id, 'cover', business.coverImage);
        hasValidUpdate = true;
        console.log('✅ Cover image updated');
      } catch (uploadError) {
        console.error('❌ Cover image upload failed:', uploadError.message);
      }
    }

    // Check if we have valid updates
    if (!hasValidUpdate && Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    // Check for phone conflict if phone is being updated
    if (updateData.phone && updateData.phone !== business.phone) {
      const existingBusiness = await Business.findOne({
        phone: updateData.phone,
        _id: { $ne: req.params.id }
      });

      if (existingBusiness) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already taken by another business'
        });
      }
    }

    // Update business
    business = await Business.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('owner', 'name email phone');

    console.log('✅ BUSINESS UPDATED:', business.name);

    res.json({
      success: true,
      data: business,
      message: 'Business updated successfully',
      updatedFields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('❌ UPDATE BUSINESS ERROR:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already taken by another business'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating business: ' + error.message
    });
  }
};

// @desc    Delete business
// @route   DELETE /api/businesses/:id
// @access  Private
const deleteBusiness = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    
    if (!business) {
      return res.status(404).json({ 
        success: false,
        message: 'Business not found' 
      });
    }

    // Check if user owns the business or is admin
    if (business.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this business'
      });
    }

    // Delete images from Supabase
    if (business.logo && business.logo.includes('supabase.co')) {
      await deleteImageFromSupabase(business.logo, 'logo');
    }
    if (business.coverImage && business.coverImage.includes('supabase.co')) {
      await deleteImageFromSupabase(business.coverImage, 'cover');
    }

    await Business.findByIdAndDelete(req.params.id);

    console.log('✅ BUSINESS DELETED:', business.name);

    res.json({
      success: true,
      message: 'Business deleted successfully'
    });

  } catch (error) {
    console.error('❌ DELETE BUSINESS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting business' 
    });
  }
};

// Helper function to delete image from Supabase
const deleteImageFromSupabase = async (imageUrl, imageType) => {
  try {
    const urlParts = imageUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const filePath = `business-${imageType}s/${fileName}`;
    
    await supabase.storage
      .from('businesses')
      .remove([filePath]);
    
    console.log(`🗑️ Deleted ${imageType} from storage:`, filePath);
  } catch (deleteError) {
    console.warn(`⚠️ Could not delete ${imageType} from storage:`, deleteError.message);
  }
};

// @desc    Upload business logo
// @route   PUT /api/businesses/:id/logo
// @access  Private
const uploadLogo = async (req, res) => {
  try {
    console.log('🖼️ UPLOAD LOGO - Request for business ID:', req.params.id);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo image provided'
      });
    }

    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Check authorization
    if (business.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this business'
      });
    }

    const logoUrl = await uploadToSupabase(req.file, business._id, 'logo', business.logo);

    const updatedBusiness = await Business.findByIdAndUpdate(
      req.params.id,
      { logo: logoUrl },
      { new: true }
    ).populate('owner', 'name email phone');

    console.log('✅ LOGO UPDATED for business:', business.name);

    res.json({
      success: true,
      data: updatedBusiness,
      message: 'Business logo updated successfully'
    });

  } catch (error) {
    console.error('❌ UPLOAD LOGO ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading logo: ' + error.message
    });
  }
};

// @desc    Upload business cover image
// @route   PUT /api/businesses/:id/cover
// @access  Private
const uploadCoverImage = async (req, res) => {
  try {
    console.log('🖼️ UPLOAD COVER - Request for business ID:', req.params.id);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No cover image provided'
      });
    }

    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Check authorization
    if (business.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this business'
      });
    }

    const coverImageUrl = await uploadToSupabase(req.file, business._id, 'cover', business.coverImage);

    const updatedBusiness = await Business.findByIdAndUpdate(
      req.params.id,
      { coverImage: coverImageUrl },
      { new: true }
    ).populate('owner', 'name email phone');

    console.log('✅ COVER IMAGE UPDATED for business:', business.name);

    res.json({
      success: true,
      data: updatedBusiness,
      message: 'Business cover image updated successfully'
    });

  } catch (error) {
    console.error('❌ UPLOAD COVER ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading cover image: ' + error.message
    });
  }
};

// @desc    Get products by business
// @route   GET /api/businesses/:businessId/products
// @access  Public
const getBusinessProducts = async (req, res) => {
  try {
    const { businessId } = req.params;
    
    if (!businessId) {
      return res.status(400).json({ 
        success: false,
        message: 'Business ID is required' 
      });
    }

    // Check if business exists
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const products = await Product.find({ business: businessId })
      .populate('business', 'name phone deliveryFee deliveryTime logo')
      .select('-__v')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    console.error('❌ GET BUSINESS PRODUCTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching business products' 
    });
  }
};

// @desc    Get businesses by owner
// @route   GET /api/businesses/owner/my-businesses
// @access  Private
const getMyBusinesses = async (req, res) => {
  try {
    const businesses = await Business.find({ owner: req.user.id })
      .populate('owner', 'name email phone')
      .select('-__v')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: businesses.length,
      data: businesses
    });
  } catch (error) {
    console.error('❌ GET MY BUSINESSES ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your businesses'
    });
  }
};

module.exports = {
  getBusinesses,
  getBusiness,
  addBusiness,
  updateBusiness,
  deleteBusiness,
  uploadLogo,
  uploadCoverImage,
  getBusinessProducts,
  getMyBusinesses
};