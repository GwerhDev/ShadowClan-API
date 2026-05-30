import express, { type Request, type Response, type NextFunction } from 'express';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import { privateSecret, allowedOrigins } from './config';
import routes from './routes';

import type { IUser } from './types';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends IUser {}
  }
}

const app = express();
app.set('trust proxy', 1);

// CORS
app.use((req: Request, res: Response, next: NextFunction): void => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

app.use(session({
  secret:            privateSecret,
  resave:            false,
  saveUninitialized: false,
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then(con => con.getClient()),
    stringify:     false,
  }),
  cookie: {
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure:   process.env.NODE_ENV === 'production',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// The passport strategy passes a BnetProfile (not a DB document), so we
// store the whole profile object in the session and pass it back as-is.
// The /login-bnet/success handler does the DB lookup via battlenetId.
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((data: unknown, done) => {
  done(null, data as IUser);
});

app.use('/', routes);

export default app;
