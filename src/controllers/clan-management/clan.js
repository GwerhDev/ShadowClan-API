const router = require('express').Router();
const Clan           = require('../../models/Clan');
const Character      = require('../../models/Character');
const User           = require('../../models/User');
const ClanInvitation = require('../../models/ClanInvitation');
const { message } = require('../../messages');

const populate = (query) =>
  query.populate('leader').populate('officer').populate('member');

// ── Character-level role helpers ─────────────────────────────────────────────
// These check the character's position in the clan document, not the user's
// system role. System admins (admin / super_admin) bypass these checks.

const isSystemAdmin = (user) =>
  user?.role === 'admin' || user?.role === 'super_admin';

const userCharIds = (user) =>
  (user?.character ?? []).map(String);

const charIsLeader = (clan, user) =>
  isSystemAdmin(user) || userCharIds(user).includes(String(clan.leader));

const charIsOfficerOrLeader = (clan, user) =>
  isSystemAdmin(user) ||
  userCharIds(user).includes(String(clan.leader)) ||
  clan.officer.some(o => userCharIds(user).includes(String(o)));

// ── Routes ───────────────────────────────────────────────────────────────────

// GET — clan with all members populated + pending invitations
router.get('/:clanId', async (req, res) => {
  try {
    const clan = await populate(Clan.findById(req.params.clanId));
    if (!clan) return res.status(404).json({ message: 'Clan not found' });
    const pendingInvitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance')
      .populate('invitedByUser', 'battletag')
      .sort({ createdAt: -1 });
    return res.status(200).json({ ...clan.toObject(), pendingInvitations });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST — add existing character to clan members (leader or officer)
router.post('/:clanId/members', async (req, res) => {
  try {
    const { characterId } = req.body;
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    const character = await Character.findById(characterId);
    if (!character) return res.status(404).json({ message: 'Character not found' });

    const alreadyIn = [
      String(clan.leader),
      ...clan.officer.map(String),
      ...clan.member.map(String),
    ].includes(String(characterId));

    if (!alreadyIn) {
      clan.member.push(characterId);
      character.clan = req.params.clanId;
      await Promise.all([clan.save(), character.save()]);
    }

    return res.status(200).json(await populate(Clan.findById(req.params.clanId)));
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// DELETE — remove character from clan (leader or officer; never the leader)
router.delete('/:clanId/members/:characterId', async (req, res) => {
  try {
    const { clanId, characterId } = req.params;
    const clan = await Clan.findById(clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    if (String(clan.leader) === characterId) {
      return res.status(400).json({ message: 'No se puede eliminar al líder del clan' });
    }

    clan.member  = clan.member.filter(m => String(m) !== characterId);
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });

    return res.status(200).json(await populate(Clan.findById(clanId)));
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST — create new character and add directly to clan (leader or officer)
router.post('/:clanId/characters', async (req, res) => {
  try {
    const { clanId } = req.params;
    const { name, resonance, currentClass } = req.body;

    const clan = await Clan.findById(clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    const character = await new Character({ name, resonance, currentClass, clan: clanId, status: 'unclaimed' }).save();
    clan.member.push(character._id);
    await clan.save();

    return res.status(201).json(await populate(Clan.findById(clanId)));
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH — update character fields: class, resonance (leader or officer)
router.patch('/:clanId/members/:characterId', async (req, res) => {
  try {
    const { clanId, characterId } = req.params;
    const { currentClass, resonance, memberStatus } = req.body;

    const clan = await Clan.findById(clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    const inClan = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)]
      .includes(characterId);
    if (!inClan) return res.status(400).json({ message: 'El personaje no pertenece a este clan' });

    const update = {};
    if (currentClass  !== undefined) update.currentClass  = currentClass || null;
    if (resonance     !== undefined) update.resonance     = Number(resonance);
    if (memberStatus  !== undefined) update.memberStatus  = memberStatus;

    await Character.findByIdAndUpdate(characterId, update);
    return res.status(200).json(await populate(Clan.findById(clanId)));
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH — change a member's role: officer ↔ member (leader only)
router.patch('/:clanId/members/:characterId/role', async (req, res) => {
  try {
    const { clanId, characterId } = req.params;
    const { role } = req.body; // 'officer' | 'member'

    if (!['officer', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Rol inválido. Use "officer" o "member"' });
    }

    const clan = await Clan.findById(clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    // Character-level leader check — officers cannot change roles
    if (!charIsLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Solo el líder del clan puede cambiar roles' });
    }

    if (String(clan.leader) === characterId) {
      return res.status(400).json({ message: 'No se puede cambiar el rol del líder' });
    }

    const inClan =
      clan.officer.map(String).includes(characterId) ||
      clan.member.map(String).includes(characterId);

    if (!inClan) {
      return res.status(404).json({ message: 'El personaje no pertenece a este clan' });
    }

    // Remove from both arrays then push to the target one
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);

    if (role === 'officer') clan.officer.push(characterId);
    else clan.member.push(characterId);

    await clan.save();
    return res.status(200).json(await populate(Clan.findById(clanId)));
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET — list pending invitations sent by the clan (leader or officer)
router.get('/:clanId/invitations', async (req, res) => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    const invitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance')
      .populate('invitedByUser', 'battletag')
      .sort({ createdAt: -1 });

    return res.status(200).json(invitations);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST — send clan invitation to a claimed character (leader or officer)
router.post('/:clanId/invitations', async (req, res) => {
  try {
    const { clanId } = req.params;
    const { characterId, role, proposedClass, proposedResonance } = req.body;

    const clan = await Clan.findById(clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });

    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }

    const character = await Character.findById(characterId);
    if (!character) return res.status(404).json({ message: 'Personaje no encontrado' });
    if (character.status !== 'claimed') {
      return res.status(400).json({ message: 'El personaje no está vinculado a un usuario' });
    }

    const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)]
      .includes(String(characterId));
    if (alreadyIn) return res.status(409).json({ message: 'El personaje ya pertenece al clan' });

    const existing = await ClanInvitation.findOne({ clan: clanId, character: characterId, status: 'pending' });
    if (existing) return res.status(409).json({ message: 'Ya existe una invitación pendiente para este personaje' });

    const invitation = await ClanInvitation.create({
      clan:              clanId,
      character:         characterId,
      invitedByUser:     req.user._id,
      role:              ['officer', 'member'].includes(role) ? role : 'member',
      proposedClass:     proposedClass  || null,
      proposedResonance: proposedResonance != null ? Number(proposedResonance) : null,
    });

    // Notify the character's owner via socket
    try {
      const { getIO } = require('../../socket');
      const io = getIO();
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) {
        const pop = await ClanInvitation.findById(invitation._id)
          .populate('clan', 'name')
          .populate('character', 'name');
        io.to(`user:${owner._id}`).emit('clan-invitation:new', {
          id:    String(pop._id),
          clan:  pop.clan,
          character: pop.character,
          role:  pop.role,
          proposedClass:     pop.proposedClass,
          proposedResonance: pop.proposedResonance,
          createdAt: pop.createdAt,
        });
      }
    } catch (e) {
      console.warn('Socket notification failed:', e.message);
    }

    return res.status(201).json({ message: 'Invitación enviada' });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// DELETE — cancel a pending invitation (leader or officer)
router.delete('/:clanId/invitations/:invitationId', async (req, res) => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) return res.status(404).json({ message: 'Clan not found' });
    if (!charIsOfficerOrLeader(clan, req.user)) {
      return res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' });
    }
    const invitation = await ClanInvitation.findOneAndDelete({
      _id: req.params.invitationId,
      clan: req.params.clanId,
      status: 'pending',
    });
    if (!invitation) return res.status(404).json({ message: 'Invitación no encontrada' });
    return res.status(200).json({ message: 'Invitación cancelada' });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
