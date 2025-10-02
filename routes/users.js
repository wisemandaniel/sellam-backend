const express = require('express');
const {
  getProfile,
  updateProfile,
  createUser
} = require('../controllers/userController');

const router = express.Router();

router.route('/')
  .post(createUser);

router.route('/profile')
  .get(getProfile)
  .put(updateProfile);

module.exports = router;