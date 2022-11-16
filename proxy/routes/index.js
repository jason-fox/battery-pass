var express = require('express');
var router = express.Router();
var proxy = require('../lib/proxy')

/* GET users listing. */
router.get('/', function(req, res, next) {
  //res.send('respond with a resource');
  proxy.response(req,res, next);
});


router.get("/entities", proxy.response);
router.get("/entities/:id", proxy.response);
router.get("/entities/:id/attrs", proxy.response);
router.get("/entities/:id/attrs/:attr", proxy.response);

module.exports = router;
