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
    const user = await userSchema.findById(decodedToken.data.id)
      .populate('character')
      .populate({ path: 'character', populate: { path: 'clan' } });

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

    return res.status(200).json({ logged: true, userData });

  } catch (error) {
    return res.status(500).send({ logged: false, message: message.user.unauthorized });
  }
});

router.delete('/account', async (req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!userToken) return res.status(401).send({ message: message.user.unauthorized });

    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findById(decodedToken.data.id);
    if (!user) return res.status(404).send({ message: message.user.notfound });

    await userSchema.findByIdAndDelete(user._id);
    res.clearCookie('u_tkn');

    try {
      const { getIO } = require('../socket');
      const io = getIO();
      const admins = await userSchema.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      admins.forEach(admin => {
        io.to(`dashboard:${admin._id}`).emit('admin:user:deleted', { id: String(user._id) });
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(200).json({ message: 'Cuenta eliminada' });
  } catch (error) {
    return res.status(500).send({ message: message.user.unauthorized });
  }
});

module.exports = router;
