const router = require('express').Router();
const ClanRequest = require('../../models/ClanRequest');
const User = require('../../models/User');
const Clan = require('../../models/Clan');
const Character = require('../../models/Character');
const { message } = require('../../messages');
const { roles } = require('../../misc/consts-user-model');

// Listar solicitudes (por defecto: pendientes)
router.get('/', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const requests = await ClanRequest.find({ status })
      .populate('user', 'battletag')
      .populate('character', 'name currentClass')
      .populate('clan', 'name')
      .sort({ createdAt: -1 });

    return res.status(200).json(requests);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// Aceptar o rechazar una solicitud
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
    }

    const request = await ClanRequest.findById(id);
    if (!request) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'La solicitud ya fue procesada' });

    if (action === 'accept') {
      await User.updateOne({ _id: request.user }, { role: roles.user });
      await Clan.updateOne({ _id: request.clan }, { $push: { member: request.character } });
      await Character.updateOne({ _id: request.character }, { clan: request.clan });
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }

    await request.save();

    const populated = await request.populate([
      { path: 'user', select: 'battletag' },
      { path: 'character', select: 'name' },
      { path: 'clan', select: 'name' },
    ]);

    return res.status(200).json({
      message: action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada',
      request: populated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
