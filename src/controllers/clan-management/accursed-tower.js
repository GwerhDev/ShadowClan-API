const router  = require('express').Router();
const AccursedTower = require('../../models/AccursedTower');
const Clan     = require('../../models/Clan');
const { message } = require('../../messages');

// ── Auth helpers ──────────────────────────────────────────────────────────────

const isSystemAdmin = (user) =>
  user?.role === 'admin' || user?.role === 'super_admin';

const charIsOfficerOrLeaderOfAnyClan = async (user) => {
  if (isSystemAdmin(user)) return true;
  const charIds = user?.character ?? [];
  if (!charIds.length) return false;
  const clan = await Clan.findOne({
    $or: [
      { leader:  { $in: charIds } },
      { officer: { $in: charIds } },
    ],
  });
  return !!clan;
};

// ── Populate helper ───────────────────────────────────────────────────────────

const populate = (query) => query
  .populate('enemyClan')
  .populate('roster.group1')
  .populate('roster.group2')
  .populate('roster.group3');

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /clan-management/tower-wars  — all active instances (management)
router.get('/', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const towerWars = await populate(AccursedTower.find({ active: true, completed: { $ne: true } }).sort({ date: 1 }));
    return res.status(200).json(towerWars);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /clan-management/tower-wars/active  — all active non-completed instances for public view
router.get('/active', async (req, res) => {
  try {
    const now = new Date();
    const baseFilter = { active: true, completed: { $ne: true } };
    // All upcoming sorted by date ascending
    let towerWars = await populate(
      AccursedTower.find({ ...baseFilter, date: { $gte: now } }).sort({ date: 1 })
    );
    // Fall back to recent past ones if none upcoming
    if (towerWars.length === 0) {
      towerWars = await populate(
        AccursedTower.find(baseFilter).sort({ date: -1 })
      );
    }
    return res.status(200).json(towerWars);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST /clan-management/tower-wars  — create new instance (multiple allowed)
router.post('/', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const { towerNumber, date, enemyClan } = req.body;
    if (!towerNumber) return res.status(400).json({ message: 'towerNumber requerido.' });
    if (!date)        return res.status(400).json({ message: 'date requerido.' });

    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(date + 'T12:00:00Z')
      : new Date(date);

    const towerWar = await new AccursedTower({
      towerNumber,
      date: parsedDate,
      enemyClan: enemyClan || null,
      roster: { group1: [], group2: [], group3: [] },
    }).save();

    const populated = await populate(AccursedTower.findById(towerWar._id));
    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /clan-management/accursed-tower/clans?q=... — search clans for enemy clan picker
router.get('/clans', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.status(200).json([]);
    const clans = await Clan.find({ name: { $regex: q.trim(), $options: 'i' } }).limit(10).lean();
    return res.status(200).json(clans);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST /clan-management/accursed-tower/clans — create enemy clan (leader or officer)
router.post('/clans', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Nombre requerido.' });
    const existing = await Clan.findOne({ name: { $regex: `^${name.trim()}$`, $options: 'i' } });
    if (existing) return res.status(409).json({ message: 'Ya existe un clan con ese nombre.' });
    const newClan = new Clan({ name: name.trim() });
    await newClan.save();
    return res.status(201).json(newClan);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET /clan-management/tower-wars/:id  — fetch single instance by ID (for history detail)
router.get('/:id', async (req, res) => {
  try {
    const towerWar = await populate(AccursedTower.findById(req.params.id));
    if (!towerWar) return res.status(404).json({ message: 'Torre no encontrada.' });
    return res.status(200).json(towerWar);
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH /clan-management/tower-wars/:id  — update towerNumber, date and/or roster
router.patch('/:id', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }

    const towerWar = await AccursedTower.findById(req.params.id);
    if (!towerWar) return res.status(404).json({ message: 'Torre no encontrada.' });

    const { towerNumber, date, roster, enemyClan, completed, result } = req.body;
    if (towerNumber !== undefined) towerWar.towerNumber = towerNumber;
    if (date !== undefined) {
      towerWar.date = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + 'T12:00:00Z')
        : new Date(date);
    }
    if (enemyClan !== undefined)   towerWar.enemyClan   = enemyClan || null;
    if (roster)                    towerWar.roster      = roster;
    if (completed !== undefined)   towerWar.completed   = completed;
    if (result !== undefined)      towerWar.result      = result;

    await towerWar.save();
    const populated = await populate(AccursedTower.findById(towerWar._id));
    return res.status(200).json(populated);
  } catch (err) {
    return res.status(500).json({ error: message.user.error, details: err.message });
  }
});

// DELETE /clan-management/tower-wars/:id  — permanently delete instance
router.delete('/:id', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }
    const deleted = await AccursedTower.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Torre no encontrada.' });
    return res.status(200).json({ message: 'Instancia de torre eliminada.' });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
