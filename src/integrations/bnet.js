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
      const user = {
        battlenetId: profile.id,
        battletag: profile.battletag,
        provider: profile.provider,
      };
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  });
});

loginBnet.on('error', function(err) {
  console.error('Passport-Bnet Strategy Error (loginBnet):', err);
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
      const user = {
        battlenetId: profile.id,
        battletag: profile.battletag,
        provider: profile.provider,
      };
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  });
});

signupBnet.on('error', function(err) {
  console.error('Passport-Bnet Strategy Error (signupBnet):', err);
});

module.exports = {
  loginBnet,
  signupBnet
}