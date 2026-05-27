const router = require('express').Router();
const ShadowWar = require('../../models/ShadowWar');
const Clan      = require('../../models/Clan');
const { message } = require('../../messages');

// ── Scope helpers ─────────────────────────────────────────────────────────────
// App administration: checks the user's system role (set by admins in /a/dashboard).
// Clan management:    checks the character's position in the clan document.
// Both scopes are kept separate so they can evolve independently.

const isSystemAdmin = (user) =>
  user?.role === 'admin' || user?.role === 'super_admin';

// Character-level check: is any of the user's characters leader or officer of
// at least one clan? Used for operations that don't have a clanId in the URL.
const charIsOfficerOrLeaderOfAnyClan = async (user) => {
  if (isSystemAdmin(user)) return true;
  const charIds = (user?.character ?? []);
  if (!charIds.length) return false;
  const clan = await Clan.findOne({
    $or: [
      { leader: { $in: charIds } },
      { officer: { $in: charIds } },
    ],
  });
  return !!clan;
};

const canDelete = (user) => isSystemAdmin(user);

const populate = (query) => query
  .populate('enemyClan')
  .populate('confirmed')
  .populate('battle.exalted.group1.character')
  .populate('battle.exalted.group2.character')
  .populate('battle.eminent.group1.character')
  .populate('battle.eminent.group2.character')
  .populate('battle.famed.group1.character')
  .populate('battle.famed.group2.character')
  .populate('battle.proud.group1.character')
  .populate('battle.proud.group2.character');

router.get('/', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const total      = await ShadowWar.countDocuments();
    const shadowWars = await ShadowWar.find().sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');

    return res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: shadowWars });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.get('/by-date', async (req, res) => {
  try {
    const searchDate = new Date(req.query.date);
    const start = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate());
    const end   = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate() + 1);

    const shadowWar = await populate(ShadowWar.findOne({ date: { $gte: start, $lt: end } }));
    if (!shadowWar) return res.status(404).json({ message: 'Shadow War not found' });

    return res.status(200).json(shadowWar);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const shadowWar = await populate(ShadowWar.findById(req.params.id));
    if (!shadowWar) return res.status(404).json({ message: 'Shadow War not found' });
    return res.status(200).json(shadowWar);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const { date, enemyClan } = req.body;
    if (!date) return res.status(400).json({ message: 'date requerido.' });

    // Append noon-UTC so the date never shifts across timezones (±12 h safe)
    const parsedDate = new Date(date + 'T12:00:00Z');

    const emptyMatches = () => Array(3).fill(null).map(() => ({
      group1: { character: [] }, group2: { character: [] }, result: 'pending',
    }));

    const newShadowWar = await new ShadowWar({
      date: parsedDate,
      enemyClan: enemyClan || null,
      confirmed: [],
      result: 'pending',
      battle: {
        exalted: emptyMatches(),
        eminent: emptyMatches(),
        famed:   emptyMatches(),
        proud:   emptyMatches(),
      },
    }).save();

    const populated = await populate(ShadowWar.findById(newShadowWar._id));
    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }

    const shadowWar = await populate(ShadowWar.findById(req.params.id));
    if (!shadowWar) return res.status(404).json({ message: 'Shadow War not found' });

    // Collect currently assigned character IDs before update
    const oldAssigned = new Set();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of shadowWar.battle[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id) oldAssigned.add(String(char._id));
        }
      }
    }

    // Fix date timezone: "YYYY-MM-DD" parsed as UTC midnight shifts in local timezones
    if (req.body.date && typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) {
      req.body.date = new Date(req.body.date + 'T12:00:00Z');
    }
    if (req.body.enemyClan === '') req.body.enemyClan = null;
    Object.assign(shadowWar, req.body);
    const updated = await shadowWar.save();
    const updatedWithPop = await populate(ShadowWar.findById(updated._id));

    // Detect newly assigned characters and notify their owners
    const newlyAssigned = [];
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of updatedWithPop.battle[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id && !oldAssigned.has(String(char._id))) {
            newlyAssigned.push(char);
          }
        }
      }
    }

    if (newlyAssigned.length > 0) {
      try {
        const { getIO } = require('../../socket');
        const User = require('../../models/User');
        const io = getIO();
        for (const char of newlyAssigned) {
          const owner = await User.findOne({ character: char._id });
          if (owner) {
            io.to(`user:${owner._id}`).emit('shadowwar:assigned', {
              id: `shadowwar:${updated._id}:${char._id}`,
              shadowWarId: String(updated._id),
              characterId: String(char._id),
              characterName: char.name,
              date: updated.date,
            });
          }
        }
      } catch (socketErr) {
        console.error('shadowwar:assigned socket error:', socketErr);
      }
    }

    return res.status(200).json(updatedWithPop);
  } catch (error) {
    return res.status(500).json({ error: message.user.error, details: error.message });
  }
});

// Confirm participation in a shadow war
router.patch('/:id/confirm', async (req, res) => {
  try {
    const charIds = (req.user?.character ?? []).map(String);
    const shadowWar = await ShadowWar.findById(req.params.id);
    if (!shadowWar) return res.status(404).json({ message: 'Shadow War not found' });

    // Find which of the user's characters are assigned in any battle slot
    const assignedUserChars = new Set();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of shadowWar.battle[cat] ?? []) {
        for (const charId of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (charIds.includes(String(charId))) assignedUserChars.add(String(charId));
        }
      }
    }

    if (assignedUserChars.size === 0) {
      return res.status(400).json({ message: 'No tienes personajes asignados en esta guerra sombría.' });
    }

    const alreadyConfirmed = new Set(shadowWar.confirmed.map(String));
    for (const id of assignedUserChars) {
      if (!alreadyConfirmed.has(id)) shadowWar.confirmed.push(id);
    }

    await shadowWar.save();
    return res.status(200).json({ message: 'Participación confirmada.' });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const deleted = await ShadowWar.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Shadow War not found' });
    return res.status(200).json({ message: 'Shadow War deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
