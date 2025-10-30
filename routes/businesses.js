const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getBusinesses,
  getBusiness,
  addBusiness,
  updateBusiness,
  deleteBusiness,
  getBusinessProducts
} = require('../controllers/businessController');

const router = express.Router();

router.get('/', getBusinesses);
router.get('/:id', getBusiness);
router.post('/', protect, addBusiness);
router.put('/:id', protect, updateBusiness);
router.delete('/:id', protect, deleteBusiness);

// Products for specific business
router.get('/:businessId/products', getBusinessProducts);

module.exports = router;