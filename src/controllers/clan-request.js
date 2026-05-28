const router = require('express').Router();
const ClanRequest = require('../models/ClanRequest');
const User = require('../models/User');
const Clan = require('../models/Clan');
const Character = require('../models/Character');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

async function getUser(req) {
  const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
  if (!userToken) return null;
  const decoded = await decodeToken(userToken);
  return User.findById(decoded.data.id);
}

// Send a clan join request
router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { characterId, clanId } = req.body;
    if (!characterId || !clanId) return res.status(400).json({ message: 'Se requiere personaje y clan' });

    const existing = await ClanRequest.findOne({ character: characterId, clan: clanId, status: 'pending' });
    if (existing) return res.status(409).json({ message: 'Ya hay una solicitud pendiente para este clan' });

    const request = await ClanRequest.create({ user: user._id, character: characterId, clan: clanId });
    await request.populate('clan', 'name');
    await request.populate('character', 'name');

    // Notify clan leaders and officers via socket
    try {
      const { getIO } = require('../socket');
      const io = getIO();
      const clan = await Clan.findById(clanId);
      if (clan) {
        const privilegedCharIds = [clan.leader, ...(clan.officer ?? [])].filter(Boolean).map(String);
        const targetUsers = await User.find({ character: { $in: privilegedCharIds } }).select('_id character');
        targetUsers.forEach(u => {
          const targetCharId = (u.character ?? []).find(c => privilegedCharIds.includes(String(c)));
          const payload = {
            id: String(request._id),
            character: request.character,
            clan: request.clan,
            createdAt: request.createdAt,
            targetCharacterId: targetCharId ? String(targetCharId) : null,
          };
          io.to(`user:${u._id}`).emit('clan-request:new', payload);
        });
      }
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(201).json({ message: 'Solicitud enviada', request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// Pending requests for the active character's clan (leader or officer only)
router.get('/manage', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const charIds = (user.character ?? []).map(String);
    const { characterId } = req.query;

    // Scope to the active character — not any character of the user
    const activeCharId = characterId && charIds.includes(String(characterId))
      ? String(characterId)
      : null;

    if (!activeCharId) return res.status(200).json([]);

    const clan = await Clan.findOne({
      $or: [{ leader: activeCharId }, { officer: activeCharId }],
    }).select('_id');

    if (!clan) return res.status(200).json([]);

    const requests = await ClanRequest.find({ clan: clan._id, status: 'pending' })
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance')
      .populate('clan', 'name')
      .sort({ createdAt: -1 });

    return res.status(200).json(requests);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// Approve or reject a request (leader/officer only)
router.patch('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
    }

    const request = await ClanRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'La solicitud ya fue procesada' });

    const clan = await Clan.findById(request.clan);
    if (!clan) return res.status(404).json({ message: 'Clan no encontrado' });

    const charIds = (user.character ?? []).map(String);
    const isPrivileged = charIds.includes(String(clan.leader)) ||
      (clan.officer ?? []).some(o => charIds.includes(String(o)));

    if (!isPrivileged) return res.status(403).json({ message: message.admin.permissionDenied });

    if (action === 'accept') {
      await Clan.updateOne({ _id: request.clan }, { $addToSet: { member: request.character } });
      await Character.updateOne({ _id: request.character }, { clan: request.clan });
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }

    await request.save();

    const populated = await ClanRequest.findById(request._id)
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance')
      .populate('clan', 'name');

    try {
      const { getIO } = require('../socket');
      const io = getIO();
      io.to(`user:${String(request.user)}`).emit('clan-request:reviewed', {
        id: String(request._id),
        action,
        clan: populated.clan,
        character: populated.character,
        createdAt: request.createdAt,
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(200).json({
      message: action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada',
      request: populated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// Get current user's own requests
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const requests = await ClanRequest.find({ user: user._id })
      .populate('clan', 'name')
      .populate('character', 'name')
      .sort({ createdAt: -1 });

    return res.status(200).json(requests);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
