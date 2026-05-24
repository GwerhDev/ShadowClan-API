const router = require('express').Router();
const clanSchema = require('../models/Clan');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

router.get('/', async (req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!userToken) return res.status(401).json({ message: message.admin.permissionDenied });

    try {
      await decodeToken(userToken);
    } catch {
      return res.status(401).json({ message: message.admin.permissionDenied });
    }

    const { name } = req.query;
    const query = name ? { name: { $regex: name, $options: 'i' } } : {};

    const clans = await clanSchema.find(query).select('_id name');

    return res.status(200).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
