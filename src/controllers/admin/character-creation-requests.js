const router = require('express').Router();
const CharacterCreationRequest = require('../../models/CharacterCreationRequest');
const Character = require('../../models/Character');
const User = require('../../models/User');
const { message } = require('../../messages');
const { roles } = require('../../misc/consts-user-model');

router.get('/', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const requests = await CharacterCreationRequest.find({ status })
      .populate('user', 'battletag role')
      .sort({ createdAt: -1 });
    return res.status(200).json(requests);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
    }

    const request = await CharacterCreationRequest.findById(id).populate('user', 'battletag role');
    if (!request) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (request.status !== 'pending') return res.status(409).json({ message: 'La solicitud ya fue procesada' });

    if (action === 'accept') {
      const character = await Character.create({
        name: request.name,
        currentClass: request.currentClass,
        resonance: request.resonance,
        status: 'claimed',
      });

      await User.updateOne(
        { _id: request.user._id },
        { $push: { character: character._id }, role: roles.user }
      );

      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }

    await request.save();

    try {
      const { getIO } = require('../../socket');
      getIO().to(`user:${String(request.user._id)}`).emit('character-request:reviewed', {
        id: String(request._id),
        action,
        type: 'creation',
        character: { name: request.name, currentClass: request.currentClass, resonance: request.resonance },
        createdAt: request.createdAt,
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(200).json({
      message: action === 'accept' ? 'Personaje creado y vinculado' : 'Solicitud rechazada',
      request,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
