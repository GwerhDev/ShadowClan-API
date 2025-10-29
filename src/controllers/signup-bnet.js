const passport = require("passport");
const router = require("express").Router();
const userSchema = require("../models/User");
const { signupBnet } = require("../integrations/bnet");
const { clientUrl } = require("../config");
const { roles, status } = require("../misc/consts-user-model");

passport.use('signup-bnet', signupBnet);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

router.get('/', passport.authenticate('signup-bnet'));

router.get('/callback', passport.authenticate('signup-bnet', {
  successRedirect: '/signup-bnet/success',
  failureRedirect: '/signup-bnet/failure'
}));

router.get('/failure', (req, res) => {
  return res.status(400).redirect(`${clientUrl}/signup/register-error`);
});

router.get('/success', async (req, res) => {
  try {
    const user = req.session.passport.user;
    const userExist = await userSchema.findOne({ battlenetId: user.battlenetId });
    if (userExist) return res.status(400).redirect(`${clientUrl}/signup/already-registered`);

    const newUser = new userSchema({
      battlenetId: user.battlenetId,
      battletag: user.battletag,
      provider: user.provider,
      status: status.pending,
      role: roles.member,
      warband: null,
    });

    await newUser.save();

    return res.status(200).redirect(`${clientUrl}/signup/register-success`);
  } catch (error) {
    console.error(error);
    return res.status(500).redirect(`${clientUrl}/signup/register-error`);
  }
});

module.exports = router;