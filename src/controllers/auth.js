const router = require('express').Router();
const userSchema = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

router.get("/", async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findOne({ _id: decodedToken.data.id })?.populate("character");
    
    if(!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const username = user.battletag.split("#")[0];
    const discriminator = user.battletag.split("#")[1];
    
    const userData = {
      id: user._id,
      battletag: user.battletag,
      username,
      discriminator,
      role: user.role,
      phone: user.phone,
      member: user.member,
      status: user.status,
      character: user.character,
    };
    
    return res.status(200).send({ logged: true, userData });
    
  } catch (error) {
    return res.status(500).send({ error: message.user.error })
  }
});

module.exports = router;