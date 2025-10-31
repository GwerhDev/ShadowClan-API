const express = require("express");
const server = express();
const routes = require("./routes");

const morgan = require("morgan");


const passport = require("passport");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { privateSecret, allowedOrigins } = require("./config");
const { production } = require("./misc/consts");

server.use(bodyParser.json({ limit: '100mb' }));
server.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
server.use(morgan('dev'));

server.use((req, res, next) => {
  console.log('request from:', req.headers.origin);
  console.log('method:', req.method);
  console.log('route:', req.url);

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Credentials', true);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Allow-Origin');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

server.use(cookieParser());

server.use(passport.initialize());
server.use('/', routes);

module.exports = server;
