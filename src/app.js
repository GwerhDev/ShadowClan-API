const express = require("express");
const server = express();
const routes = require("./routes");

const morgan = require("morgan");
const session = require("express-session");

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
  console.log('allowed origins:', allowedOrigins);

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

server.use(session({
  secret: privateSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: process.env.NODE_ENV === production ? 'None' : 'Lax',
    secure: process.env.NODE_ENV === production ? true : false,
    domain: process.env.NODE_ENV === production ? '.shadowclan.cl' : undefined
  }
}));

server.use(passport.initialize());
server.use(bodyParser.json());
server.use(passport.session());
server.use('/', routes);

module.exports = server;