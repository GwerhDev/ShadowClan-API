const router = require('express').Router();
const clanSchema = require('../models/Clan');
const characterSchema = require('../models/Character');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

router.get('/', async (req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findById(decodedToken.data.id);
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { q, page = 1, limit = 10 } = req.query;
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};

    const clans = await clanSchema.find(query)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    return res.status(200).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;