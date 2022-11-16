var express = require('express');
const router = express.Router();
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var aasRouter = require('./routes/aas');

var app = express();
app.disable('x-powered-by')

app.use(logger('dev'));
const bodyParser = require('body-parser');




// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());
app.use(bodyParser.json({ type: 'application/*+json' }));



app.use("/ngsi-ld/v1", indexRouter);
app.use("/aas", aasRouter);

module.exports = app;
