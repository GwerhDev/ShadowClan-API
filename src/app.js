const express = require("express");
const server = express();
const routes = require("./routes");

const morgan = require("morgan");
const session = require("express-session");
const passport = require("passport");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");

const { privateSecret, allowedOrigins, environment } = require("./config");
const { production } = require("./misc/consts");

server.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Credentials', true);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

server.use(bodyParser.json({ limit: '100mb' }));
server.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
server.use(cookieParser());
server.use(morgan('dev'));

server.use(session({
  secret: privateSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: environment === production ? 'None' : 'Lax',
    secure: environment === production ? true : false,
  }
}));
server.use(passport.initialize());
server.use(passport.session());

server.use('/', routes);

module.exports = server;
