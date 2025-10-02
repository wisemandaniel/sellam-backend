const express = require('express');
const {
  getStores,
  getStore,
  getStoreProducts,
  createStore,
  updateStore,
  deleteStore
} = require('../controllers/storeController');

const router = express.Router();

router.route('/')
  .get(getStores)
  .post(createStore);

router.route('/:id')
  .get(getStore)
  .put(updateStore)
  .delete(deleteStore);

router.route('/:id/products')
  .get(getStoreProducts);

module.exports = router;