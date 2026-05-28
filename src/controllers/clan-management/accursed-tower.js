const router        = require('express').Router();
const AccursedTower = require('../../models/AccursedTower');
const Clan          = require('../../models/Clan');
const Character     = require('../../models/Character');
const ClanPost      = require('../../models/ClanPost');
const { message }   = require('../../messages');

const isAdmin = (user) => user?.role === 'admin' || user?.role === 'super_admin';

async function resolveClan(user, characterId) {
  if (isAdmin(user)) return null;
  const userCharIds = (user?.character ?? []).map(String);
  if (!characterId || !userCharIds.includes(String(characterId))) return false;
  const char = await Character.findById(characterId).select('clan');
  return char?.clan ?? false;
}

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
  .populate('roster.group1')
  .populate('roster.group2')
  .populate('roster.group3');

// GET / — active towers for the active character's clan
router.get('/', async (req, res) => {
  try {
    const clanId = await resolveClan(req.user, req.query.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
    const filter = { completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    const towers = await populate(AccursedTower.find(filter).sort({ date: 1 }));
    return res.status(200).json(towers);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /active — same, used by player-facing page
router.get('/active', async (req, res) => {
  try {
    const clanId = await resolveClan(req.user, req.query.characterId);
    // No 403 here — walker characters just get empty list
    const baseFilter = { active: true, completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    const now = new Date();
    let towers = await populate(AccursedTower.find({ ...baseFilter, date: { $gte: now } }).sort({ date: 1 }));
    if (!towers.length) towers = await populate(AccursedTower.find(baseFilter).sort({ date: -1 }));
    return res.status(200).json(towers);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST / — create tower
router.post('/', async (req, res) => {
  try {
    const clanId = await resolveClanForWrite(req.user, req.body.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });

    const { towerNumber, date, enemyClan } = req.body;
    if (!towerNumber) return res.status(400).json({ message: 'towerNumber requerido.' });
    if (!date)        return res.status(400).json({ message: 'date requerido.' });

    const tower = await new AccursedTower({
      clan:        clanId || null,
      towerNumber,
      date:        /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : new Date(date),
      enemyClan:   enemyClan || null,
      roster:      { group1: [], group2: [], group3: [] },
    }).save();

    const populated = await populate(AccursedTower.findById(tower._id));

    // Auto-create call-to-arms post
    try {
      if (clanId) {
        const clanDoc = await Clan.findById(clanId).select('leader officer');
        const charIds = (req.user?.character ?? []).map(String);
        const authorId = charIds.find(id =>
          String(clanDoc.leader) === id || (clanDoc.officer ?? []).some(o => String(o) === id)
        );
        if (authorId) {
          await ClanPost.create({ clan: clanId, author: authorId, content: '', source: 'accursed_tower', referenceId: tower._id, auto: true });
        }
      }
    } catch (e) { console.error('call-to-arms (accursed_tower):', e); }

    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /clans?q= — search clans for enemy clan picker
router.get('/clans', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.status(200).json([]);
    const clans = await Clan.find({ name: { $regex: q.trim(), $options: 'i' } }).limit(10).lean();
    return res.status(200).json(clans);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST /clans — create enemy clan
router.post('/clans', async (req, res) => {
  try {
    const clanId = await resolveClanForWrite(req.user, req.body.characterId);
    if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Nombre requerido.' });
    const existing = await Clan.findOne({ name: { $regex: `^${name.trim()}$`, $options: 'i' } });
    if (existing) return res.status(409).json({ message: 'Ya existe un clan con ese nombre.' });
    const newClan = await new Clan({ name: name.trim() }).save();
    return res.status(201).json(newClan);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST /:id/respond — respond to call to arms
router.post('/:id/respond', async (req, res) => {
  try {
    const charIds = (req.user?.character ?? []).map(String);
    const { characterId } = req.body;
    const charId = characterId && charIds.includes(String(characterId)) ? String(characterId) : charIds[0];
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) return res.status(404).json({ message: 'Torre no encontrada.' });
    const already = new Set((tower.confirmed ?? []).map(String));
    if (!already.has(charId)) { tower.confirmed.push(charId); await tower.save(); }
    return res.status(200).json({ confirmed: true });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const tower = await populate(AccursedTower.findById(req.params.id));
    if (!tower) return res.status(404).json({ message: 'Torre no encontrada.' });
    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.query.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(tower.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }
    return res.status(200).json(tower);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH /:id
router.patch('/:id', async (req, res) => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) return res.status(404).json({ message: 'Torre no encontrada.' });
    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.body.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(tower.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const { towerNumber, date, roster, enemyClan, completed, result } = req.body;
    if (towerNumber !== undefined) tower.towerNumber = towerNumber;
    if (date !== undefined) tower.date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : new Date(date);
    if (enemyClan !== undefined) tower.enemyClan = enemyClan || null;
    if (roster)                  tower.roster    = roster;
    if (completed !== undefined) tower.completed = completed;
    if (result !== undefined)    tower.result    = result;
    await tower.save();
    return res.status(200).json(await populate(AccursedTower.findById(tower._id)));
  } catch (err) {
    return res.status(500).json({ error: message.user.error, details: err.message });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) return res.status(404).json({ message: 'Torre no encontrada.' });
    if (!isAdmin(req.user)) {
      const clanId = await resolveClan(req.user, req.query.characterId);
      if (clanId === false) return res.status(403).json({ message: message.admin.permissionDenied });
      if (clanId && String(tower.clan ?? '') !== String(clanId))
        return res.status(403).json({ message: message.admin.permissionDenied });
    }
    await AccursedTower.findByIdAndDelete(req.params.id);
    return res.status(200).json({ message: 'Torre eliminada.' });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
