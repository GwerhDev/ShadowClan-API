const router = require('express').Router();
const CharacterClaim = require('../../models/CharacterClaim');
const Character = require('../../models/Character');
const User = require('../../models/User');
const { message } = require('../../messages');

// List character claims (default: pending)
router.get('/', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const claims = await CharacterClaim.find({ status })
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance')
      .sort({ createdAt: -1 });

    return res.status(200).json(claims);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// Accept or reject a character claim
router.patch('/:id', async (req, res) => {
  try {
    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
    }

    const claim = await CharacterClaim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (claim.status !== 'pending') return res.status(409).json({ message: 'La solicitud ya fue procesada' });

    if (action === 'accept') {
      await Character.updateOne({ _id: claim.character }, { status: 'claimed' });
      await User.updateOne({ _id: claim.user }, { $addToSet: { character: claim.character } });
      claim.status = 'accepted';
    } else {
      await Character.updateOne({ _id: claim.character }, { status: 'unclaimed' });
      claim.status = 'rejected';
    }

    await claim.save();

    const populated = await CharacterClaim.findById(claim._id)
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance');

    try {
      const { getIO } = require('../../socket');
      getIO().to(`user:${String(claim.user)}`).emit('character-request:reviewed', {
        id: String(claim._id),
        action,
        type: 'claim',
        character: populated.character,
        createdAt: claim.createdAt,
      });
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(200).json({
      message: action === 'accept' ? 'Vinculación aprobada' : 'Vinculación rechazada',
      claim: populated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
