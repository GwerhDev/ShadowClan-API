const router        = require('express').Router();
const ClanInvitation = require('../models/ClanInvitation');
const Clan           = require('../models/Clan');
const Character      = require('../models/Character');
const User           = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

async function getUser(req) {
  const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
  if (!userToken) return null;
  const decoded = await decodeToken(userToken);
  return User.findById(decoded.data.id);
}

// GET / — pending invitations for the current user's characters
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const charIds = (user.character ?? []).map(String);
    const invitations = await ClanInvitation.find({
      character: { $in: charIds },
      status: 'pending',
    })
      .populate('clan', 'name')
      .populate('character', 'name currentClass resonance')
      .populate('invitedByUser', 'battletag')
      .sort({ createdAt: -1 });

    return res.status(200).json(invitations);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH /:id — accept or reject invitation (owner of the character)
router.patch('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
    }

    const invitation = await ClanInvitation.findById(req.params.id);
    if (!invitation) return res.status(404).json({ message: 'Invitación no encontrada' });
    if (invitation.status !== 'pending') return res.status(409).json({ message: 'La invitación ya fue procesada' });

    const charIds = (user.character ?? []).map(String);
    if (!charIds.includes(String(invitation.character))) {
      return res.status(403).json({ message: 'No tienes permiso para responder esta invitación' });
    }

    if (action === 'accept') {
      const clan = await Clan.findById(invitation.clan);
      if (!clan) return res.status(404).json({ message: 'Clan no encontrado' });

      const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)]
        .includes(String(invitation.character));

      if (!alreadyIn) {
        if (invitation.role === 'officer') {
          clan.officer.push(invitation.character);
        } else {
          clan.member.push(invitation.character);
        }
        await clan.save();
        await Character.findByIdAndUpdate(invitation.character, { clan: invitation.clan });
      }

      // Apply proposed character changes if any
      const charUpdate = {};
      if (invitation.proposedClass     != null) charUpdate.currentClass = invitation.proposedClass || null;
      if (invitation.proposedResonance != null) charUpdate.resonance    = invitation.proposedResonance;
      if (Object.keys(charUpdate).length) {
        await Character.findByIdAndUpdate(invitation.character, charUpdate);
      }

      invitation.status = 'accepted';
    } else {
      invitation.status = 'rejected';
    }

    await invitation.save();

    return res.status(200).json({
      message: action === 'accept' ? 'Invitación aceptada' : 'Invitación rechazada',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
