const router = require('express').Router();
const CharacterClaim = require('../models/CharacterClaim');
const Character = require('../models/Character');
const User = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

async function getUser(req) {
  const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
  if (!userToken) return null;
  const decoded = await decodeToken(userToken);
  return User.findById(decoded.data.id);
}

// User submits a character claim request
router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ message: 'Se requiere el ID del personaje' });

    const character = await Character.findById(characterId);
    if (!character) return res.status(404).json({ message: 'Personaje no encontrado' });
    if (character.status !== 'unclaimed') {
      return res.status(409).json({ message: 'El personaje no está disponible para reclamar' });
    }

    const existing = await CharacterClaim.findOne({ character: characterId, status: 'pending' });
    if (existing) return res.status(409).json({ message: 'Ya hay una solicitud pendiente para este personaje' });

    const claim = await CharacterClaim.create({ user: user._id, character: characterId });
    await Character.updateOne({ _id: characterId }, { status: 'pending' });
    await claim.populate('character', 'name currentClass resonance');

    try {
      const { getIO } = require('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      admins.forEach(admin => {
        io.to(`dashboard:${admin._id}`).emit('admin:request:new', {
          type: 'character-claim',
          id: String(claim._id),
          character: claim.character,
          user: { battletag: user.battletag },
          createdAt: claim.createdAt,
        });
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(201).json({ message: 'Solicitud de vinculación enviada', claim });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// Get current user's own claims
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const claims = await CharacterClaim.find({ user: user._id })
      .populate('character', 'name currentClass resonance')
      .sort({ createdAt: -1 });

    return res.status(200).json(claims);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
