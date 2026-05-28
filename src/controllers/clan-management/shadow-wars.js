const router     = require('express').Router();
const ShadowWar  = require('../../models/ShadowWar');
const Clan       = require('../../models/Clan');
const Character  = require('../../models/Character');
const ClanPost   = require('../../models/ClanPost');
const { message } = require('../../messages');

const isAdmin = (user) => user?.role === 'admin' || user?.role === 'super_admin';

// Returns the clan._id for the characterId if it belongs to req.user.
// Returns null if admin (bypass). Returns false if unauthorized.
async function resolveClan(user, characterId) {
  if (isAdmin(user)) return null;
  const userCharIds = (user?.character ?? []).map(String);
  if (!characterId || !userCharIds.includes(String(characterId))) return false;
  const char = await Character.findById(characterId).select('clan');
  return char?.clan ?? false;
}

// Same but also verifies leader/officer.
// Admins bypass the leader/officer check but still resolve the clan from the character.
async function resolveClanForWrite(user, characterId) {
  if (isAdmin(user)) {
    if (!characterId) return null;
    const char = await Character.findById(characterId).select('clan');
    return char?.clan ?? null;
  }
  const clanId = await resolveClan(user, characterId);
  if (!clanId) return false;
  const clan = await Clan.findOne({
    _id: clanId,
    $or: [{ leader: String(characterId) }, { officer: String(characterId) }],
  }).select('_id');
  return clan?._id ?? false;
}

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

// GET / — shadow wars for the active character's clan
router.get('/', async (req, res) => {
  try {
    const clanId = await resolveClan(req.user, req.query.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;
    const filter = clanId ? { clan: clanId } : {};

    const total      = await ShadowWar.countDocuments(filter);
    const shadowWars = await ShadowWar.find(filter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
    return res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: shadowWars });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.get('/by-date', async (req, res) => {
  try {
    const clanId = await resolveClan(req.user, req.query.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });

    const d     = new Date(req.query.date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const filter = clanId
      ? { clan: clanId, date: { $gte: start, $lt: end } }
      : { date: { $gte: start, $lt: end } };

    const sw = await populate(ShadowWar.findOne(filter));
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });
    return res.status(200).json(sw);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const sw = await populate(ShadowWar.findById(req.params.id));
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });
    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.query.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(sw.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }
    return res.status(200).json(sw);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.post('/', async (req, res) => {
  try {
    const clanId = await resolveClanForWrite(req.user, req.body.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });

    const { date, enemyClan } = req.body;
    if (!date) return res.status(400).json({ message: 'date requerido.' });

    const emptyMatches = () => Array(3).fill(null).map(() => ({
      group1: { character: [] }, group2: { character: [] }, result: 'pending',
    }));

    const newSW = await new ShadowWar({
      clan:      clanId || null,
      date:      new Date(date + 'T12:00:00Z'),
      enemyClan: enemyClan || null,
      confirmed: [],
      result:    'pending',
      battle: {
        exalted: emptyMatches(), eminent: emptyMatches(),
        famed:   emptyMatches(), proud:   emptyMatches(),
      },
    }).save();

    const populated = await populate(ShadowWar.findById(newSW._id));

    // Auto-create call-to-arms post
    try {
      if (clanId) {
        const clanDoc = await Clan.findById(clanId).select('leader officer');
        const charIds = (req.user?.character ?? []).map(String);
        const authorId = charIds.find(id =>
          String(clanDoc.leader) === id || (clanDoc.officer ?? []).some(o => String(o) === id)
        );
        if (authorId) {
          await ClanPost.create({ clan: clanId, author: authorId, content: '', source: 'shadow_war', referenceId: newSW._id, auto: true });
        }
      }
    } catch (e) { console.error('call-to-arms (shadow_war):', e); }

    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const sw = await populate(ShadowWar.findById(req.params.id));
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });

    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.body.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(sw.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }

    const oldAssigned = new Set();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of sw.battle[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id) oldAssigned.add(String(char._id));
        }
      }
    }

    if (req.body.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date))
      req.body.date = new Date(req.body.date + 'T12:00:00Z');
    if (req.body.enemyClan === '') req.body.enemyClan = null;
    Object.assign(sw, req.body);
    const updated     = await sw.save();
    const updatedPop  = await populate(ShadowWar.findById(updated._id));

    const newlyAssigned = [];
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of updatedPop.battle[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char);
        }
      }
    }

    if (newlyAssigned.length > 0) {
      try {
        const { getIO } = require('../../socket');
        const User = require('../../models/User');
        const io = getIO();
        const confirmedIds = new Set((updatedPop.confirmed ?? []).map(c => String(c._id ?? c)));
        for (const char of newlyAssigned) {
          if (confirmedIds.has(String(char._id))) continue;
          const owner = await User.findOne({ character: char._id });
          if (owner) {
            io.to(`user:${owner._id}`).emit('shadowwar:assigned', {
              id: `shadowwar:${updated._id}:${char._id}`,
              shadowWarId: String(updated._id), characterId: String(char._id),
              characterName: char.name, date: updated.date,
            });
          }
        }
      } catch (e) { console.error('shadowwar:assigned socket error:', e); }
    }

    return res.status(200).json(updatedPop);
  } catch (err) {
    return res.status(500).json({ error: message.user.error, details: err.message });
  }
});

router.patch('/:id/confirm', async (req, res) => {
  try {
    const charIds = (req.user?.character ?? []).map(String);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });

    const assigned = new Set();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud']) {
      for (const match of sw.battle[cat] ?? []) {
        for (const id of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (charIds.includes(String(id))) assigned.add(String(id));
        }
      }
    }
    if (!assigned.size) return res.status(400).json({ message: 'No tienes personajes asignados.' });

    const confirmed = new Set(sw.confirmed.map(String));
    for (const id of assigned) { if (!confirmed.has(id)) sw.confirmed.push(id); }
    await sw.save();
    return res.status(200).json({ message: 'Participación confirmada.' });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.post('/:id/respond', async (req, res) => {
  try {
    const charIds = (req.user?.character ?? []).map(String);
    const { characterId } = req.body;
    const charId = characterId && charIds.includes(String(characterId)) ? String(characterId) : charIds[0];
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });
    const already = new Set(sw.confirmed.map(String));
    if (!already.has(charId)) { sw.confirmed.push(charId); await sw.save(); }
    return res.status(200).json({ confirmed: true });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) return res.status(404).json({ message: 'Shadow War not found' });
    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.query.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(sw.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }
    await ShadowWar.findByIdAndDelete(req.params.id);
    return res.status(200).json({ message: 'Shadow War deleted' });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
