const express = require('express');
const router = express.Router();
const aas = require('../lib/aas');
const subscription = require('../lib/subscription');

router.get('/', aas.readData);

router.post('/subscription', subscription.notify);
router.get('/subscribe', subscription.create);

module.exports = router;
