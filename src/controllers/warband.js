const router = require('express').Router();
const userSchema = require('../models/User');
const warbandSchema = require('../models/Warband');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

router.get('/', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findOne({ _id: decodedToken.data.id });

    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const response = await warbandSchema.find();

    return res.status(200).send(response);
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

module.exports = router;