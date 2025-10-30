const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getRiders,
  addRider,
  updateRider,
  deleteRider
} = require('../controllers/riderController');

const router = express.Router();

router.get('/', getRiders);
router.post('/', protect, addRider);
router.put('/:id', protect, updateRider);
router.delete('/:id', protect, deleteRider);

module.exports = router;