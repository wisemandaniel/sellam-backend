const express = require('express');
const router = express.Router();
const {
  getAllAgencies,
  getAgencyById,
  createAgency,
  updateAgency,
  deleteAgency,
  getRoutes
} = require('../controllers/agencyController');

// Optional: protect admin routes
// const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(getAllAgencies)
  .post(createAgency); // .post(protect, admin, createAgency)

router.get('/routes', getRoutes);

router.route('/:id')
  .get(getAgencyById)
  .put(updateAgency)   // .put(protect, admin, updateAgency)
  .delete(deleteAgency); // .delete(protect, admin, deleteAgency)

module.exports = router;