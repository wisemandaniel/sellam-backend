const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  console.log('🔐 ========== AUTH MIDDLEWARE START ==========');
  console.log('🔐 AUTH - Request URL:', req.originalUrl);
  console.log('🔐 AUTH - Request method:', req.method);
  console.log('🔐 AUTH - Headers authorization present:', !!req.headers.authorization);
  
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('🔐 AUTH - Token extracted:', token ? `${token.substring(0, 20)}...` : 'NO TOKEN');
    } else {
      console.log('🔐 AUTH - No Bearer token found in headers');
    }

    if (!token) {
      console.log('❌ AUTH - No token provided');
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, no token' 
      });
    }

    try {
      console.log('🔐 AUTH - Verifying token with JWT secret...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('🔐 AUTH - Token decoded successfully:', decoded);
      
      console.log('🔐 AUTH - Finding user by ID:', decoded.id);
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        console.log('❌ AUTH - User not found for ID:', decoded.id);
        return res.status(401).json({ 
          success: false,
          message: 'Not authorized, user not found' 
        });
      }
      
      console.log('✅ AUTH - User found:', req.user._id, req.user.role);
      console.log('🔐 ========== AUTH MIDDLEWARE SUCCESS ==========');
      next();
    } catch (error) {
      console.log('❌ AUTH - Token verification failed:', error.message);
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, token failed' 
      });
    }
  } catch (error) {
    console.log('❌ AUTH - Middleware error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error in authentication' 
    });
  }
};

const admin = (req, res, next) => {
  console.log('👑 ADMIN CHECK - User role:', req.user?.role);
  
  if (req.user && req.user.role === 'admin') {
    console.log('✅ ADMIN CHECK - User is admin');
    next();
  } else {
    console.log('❌ ADMIN CHECK - User is not admin');
    res.status(403).json({ 
      success: false,
      message: 'Not authorized as admin' 
    });
  }
};

// New authorize middleware for role-based access
const authorize = (...roles) => {
  return (req, res, next) => {
    console.log('🎯 AUTHORIZE CHECK - Required roles:', roles);
    console.log('🎯 AUTHORIZE CHECK - User role:', req.user?.role);
    
    if (!req.user) {
      console.log('❌ AUTHORIZE CHECK - No user found in request');
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, no user' 
      });
    }

    if (!roles.includes(req.user.role)) {
      console.log('❌ AUTHORIZE CHECK - User role not authorized');
      return res.status(403).json({ 
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route. Required roles: ${roles.join(', ')}` 
      });
    }

    console.log('✅ AUTHORIZE CHECK - User role authorized');
    next();
  };
};

module.exports = { protect, admin, authorize };