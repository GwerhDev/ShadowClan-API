const router = require("express").Router();
const passport = require("passport");
const userSchema = require("../models/User");
const { loginBnet } = require("../integrations/bnet");
const { clientUrl, appClientUrl } = require("../config");
const { createToken } = require("../integrations/jwt");
const { status } = require("../misc/consts-user-model");
require("dotenv").config();

passport.use('login-bnet', loginBnet);

router.get('/', function(req, res, next) {
  console.log('Session before Bnet redirect (GET /):', req.session); // Add this log
  req.session.save(function (err) {
    if (err) {
      console.error('Error saving session before Bnet redirect:', err);
      return next(err);
    }
    passport.authenticate('login-bnet')(req, res, next);
  });
});

router.get('/callback', function(req, res, next) {
  console.log('Session after Bnet callback (GET /callback):', req.session); // Add this log
  passport.authenticate('login-bnet', function(err, user, info) {
    if (err) {
      console.error('Passport-Bnet Authenticate Error:', err);
      return res.redirect('/login-bnet/failure');
    }
    if (!user) {
      console.log('Passport-Bnet Authenticate Info:', info);
      return res.redirect('/login-bnet/failure');
    }
    req.logIn(user, function(err) {
      if (err) {
        console.error('Passport-Bnet Login Error:', err);
        return res.redirect('/login-bnet/failure');
      }
      return res.redirect('/login-bnet/success');
    });
  })(req, res, next);
});

router.get('/failure', (req, res) => {
  return res.status(400).redirect(`${clientUrl}/login/login-error`);
});

router.get('/success', async (req, res) => {
  try {
    const user = req.session.passport.user;
    const userExist = await userSchema.findOne({ battlenetId: user.battlenetId });

    if (userExist && userExist.status === status.pending) return res.status(400).redirect(`${clientUrl}/login/user-pending-approve`);
    if (userExist && userExist.status === status.inactive) return res.status(400).redirect(`${clientUrl}/login/user-inactive`);

    if (userExist && userExist.status === status.active) {
      const { _id, role } = userExist;
      const data_login = { id: _id, role };
      const token = await createToken(data_login, 3);

      if (process.env.NODE_ENV === "production") {
        res.cookie("u_tkn", token, {
          httpOnly: true,
          secure: true,
          sameSite: "None",
          domain: ".shadowclan.cl",
          path: "/",
          maxAge: 24 * 60 * 60 * 1000
        });
      } else {
        res.cookie("u_tkn", token, {
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
          path: "/",
          maxAge: 24 * 60 * 60 * 1000
        });
      }

      return res.status(200).redirect(appClientUrl);
    } else {
      return res.status(400).redirect(`${clientUrl}/auth/not_found`);
    }
  } catch (error) {
    console.error(error);
    return res.status(500).redirect(`${clientUrl}/auth/error`);
  }
});

module.exports = router;