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
    const newShadowWar = await new ShadowWar(req.body).save();
    return res.status(201).json(newShadowWar);
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

    if (req.body.enemyClan === '') req.body.enemyClan = null;
    Object.assign(shadowWar, req.body);
    const updated = await shadowWar.save();

    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ error: message.user.error, details: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!canDelete(req.user)) {
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
