// middleware/uploadMiddleware.js
const multer = require('multer');

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Maximum 10 files
  }
});

// Middleware to convert multer format to express-fileupload format
const convertMulterToFileUpload = (req, res, next) => {
  if (req.files) {
    // Convert single file to array format expected by your controller
    if (!Array.isArray(req.files)) {
      // If it's a single file, convert to array
      req.files = {
        images: [req.file].filter(Boolean) // Remove null/undefined
      };
    } else {
      // If it's multiple files, structure them as { images: [...] }
      req.files = { images: req.files };
    }
  } else if (req.file) {
    // Handle single file upload
    req.files = {
      images: [req.file]
    };
  }
  next();
};

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 images allowed.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field. Please use correct field names.'
      });
    }
  } else if (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  next();
};

module.exports = { 
  upload, 
  handleUploadError, 
  convertMulterToFileUpload 
};