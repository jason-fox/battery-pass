var express = require('express');
var router = express.Router();
var aas = require('../lib/aas')

router.post("/", aas.response);
router.get("/", aas.readData);

module.exports = router;

