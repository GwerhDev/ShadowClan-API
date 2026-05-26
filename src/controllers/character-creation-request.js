const router = require('express').Router();
const CharacterCreationRequest = require('../models/CharacterCreationRequest');
const User = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

async function getUser(req) {
  const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
  if (!userToken) return null;
  const decoded = await decodeToken(userToken);
  return User.findById(decoded.data.id);
}

router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { name, currentClass, resonance } = req.body;
    if (!name || !currentClass) {
      return res.status(400).json({ message: 'Nombre y clase son obligatorios' });
    }

    const existing = await CharacterCreationRequest.findOne({ user: user._id, status: 'pending' });
    if (existing) {
      return res.status(409).json({ message: 'Ya tienes una solicitud de creación pendiente' });
    }

    const request = await CharacterCreationRequest.create({ user: user._id, name, currentClass, resonance });

    try {
      const { getIO } = require('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      admins.forEach(admin => {
        io.to(`dashboard:${admin._id}`).emit('admin:request:new', {
          type: 'character-creation',
          id: String(request._id),
          user: { battletag: user.battletag },
          character: { name, currentClass, resonance },
          createdAt: request.createdAt,
        });
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(201).json({ message: 'Solicitud de creación enviada', request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const requests = await CharacterCreationRequest.find({ user: user._id }).sort({ createdAt: -1 });
    return res.status(200).json(requests);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
