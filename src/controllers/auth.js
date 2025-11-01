const router = require('express').Router();
const userSchema = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

router.get("/", async (req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];

    if (!userToken) {
      return res.status(401).send({ logged: false, message: message.user.unauthorized });
    }

    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findById(decodedToken.data.id);
    
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });
    
    const username = user.battletag.split("#")[0];
    const discriminator = user.battletag.split("#")[1];

    const userData = {
      id: user._id,
      battletag: user.battletag,
      username,
      discriminator,
      role: user.role,
      phone: user.phone,
      status: user.status,
      character: user.character,
    };
    console.log(userData.character[0].clan);

    return res.status(200).json({ logged: true, userData });

  } catch (error) {
    return res.status(500).send({ logged: false, message: message.user.unauthorized });
  }
});

module.exports = router;