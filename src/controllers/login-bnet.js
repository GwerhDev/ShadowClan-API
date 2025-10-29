const router = require("express").Router();
const passport = require("passport");
const { loginBnet } = require("../integrations/bnet");
const userSchema = require("../models/User");
const { clientUrl } = require("../config");
const { createToken } = require("../integrations/jwt");
const { status } = require("../misc/consts-user-model");

passport.use('login-bnet', loginBnet);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

router.get('/', passport.authenticate('login-bnet'));

router.get('/callback', passport.authenticate('login-bnet', {
  successRedirect: '/login-bnet/success',
  failureRedirect: '/login-bnet/failure'
}));

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

      return res.status(200).redirect(`${clientUrl}/auth/${token}`);
    } else {
      return res.status(400).redirect(`${clientUrl}/auth/not_found`);
    }
  } catch (error) {
    console.error(error);
    return res.status(500).redirect(`${clientUrl}/auth/error`);
  }
});

module.exports = router;