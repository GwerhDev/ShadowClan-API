const express = require("express");
const server = express();
server.set('trust proxy', 1); // Add this line
const routes = require("./routes");

const morgan = require("morgan");
const session = require("express-session");
const passport = require("passport");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose"); // Added mongoose import

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");

const { privateSecret, allowedOrigins, mongodbString } = require("./config"); // Added mongodbString
const DB = require("./integrations/mongodb");

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
  saveUninitialized: true, // Changed to true for debugging
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then(con => con.getClient()),
    stringify: false,
  }),
  cookie: {
    sameSite: process.env.NODE_ENV === "production" ? 'None' : 'Lax',
    secure: process.env.NODE_ENV === "production" ? true : false,
    // Removed domain setting
  }
}));
server.use(passport.initialize());
server.use(passport.session());

// Import User model
const User = require('./models/User');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

server.use('/', routes);

module.exports = server;
