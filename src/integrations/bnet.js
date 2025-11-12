const { apiUrl, bnetClient, bnetSecret } = require('../config');
const BnetStrategy = require('passport-bnet').Strategy;

const loginBnet = new BnetStrategy({
  clientID: bnetClient,
  clientSecret: bnetSecret,
  callbackURL: `${apiUrl}/login-bnet/callback`,
  region: "us",
  scope: "openid",
  state: true,
}, function (accessToken, refreshToken, profile, done) {
  process.nextTick(async function () {
    try {
      console.log("BnetStrategy verify callback - profile:", profile); // Add this log
      const user = {
        battlenetId: profile.id,
        battletag: profile.battletag,
        provider: profile.provider,
      };
      console.log("BnetStrategy verify callback - user object:", user); // Add this log
      return done(null, user);
    } catch (error) {
      console.error("BnetStrategy verify callback - error:", error); // Add this log
      return done(error);
    }
  });
});

const signupBnet = new BnetStrategy({
  clientID: bnetClient,
  clientSecret: bnetSecret,
  callbackURL: `${apiUrl}/signup-bnet/callback`,
  region: "us",
  scope: "openid",
  state: true,
}, function (accessToken, refreshToken, profile, done) {
  process.nextTick(async function () {
    try {
      console.log("BnetStrategy verify callback - profile:", profile); // Add this log
      const user = {
        battlenetId: profile.id,
        battletag: profile.battletag,
        provider: profile.provider,
      };
      console.log("BnetStrategy verify callback - user object:", user); // Add this log
      return done(null, user);
    } catch (error) {
      console.error("BnetStrategy verify callback - error:", error); // Add this log
      return done(error);
    }
  });
});

module.exports = {
  loginBnet,
  signupBnet
}