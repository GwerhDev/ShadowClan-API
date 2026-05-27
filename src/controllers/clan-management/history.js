const router        = require('express').Router();
const ShadowWar     = require('../../models/ShadowWar');
const AccursedTower = require('../../models/AccursedTower');
const Clan          = require('../../models/Clan');
const { message }   = require('../../messages');

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

// GET /clan-management/history?type=all|shadow_war|accursed_tower&page=1&limit=10
router.get('/', async (req, res) => {
  try {
    if (!await charIsOfficerOrLeaderOfAnyClan(req.user)) {
      return res.status(403).json({ message: message.admin.permissionDenied });
    }

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;
    const type  = req.query.type || 'all';

    if (type === 'shadow_war') {
      const total = await ShadowWar.countDocuments();
      const data  = await ShadowWar.find().sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      return res.status(200).json({
        total, page, limit,
        pages: Math.ceil(total / limit),
        data: data.map(d => ({ ...d.toObject(), type: 'shadow_war' })),
      });
    }

    if (type === 'accursed_tower') {
      const total = await AccursedTower.countDocuments();
      const data  = await AccursedTower.find().sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      return res.status(200).json({
        total, page, limit,
        pages: Math.ceil(total / limit),
        data: data.map(d => ({ ...d.toObject(), type: 'accursed_tower' })),
      });
    }

    // type === 'all': fetch both, merge sorted by date, paginate in memory
    const [swAll, atAll] = await Promise.all([
      ShadowWar.find().sort({ date: -1 }).populate('enemyClan'),
      AccursedTower.find().sort({ date: -1 }).populate('enemyClan'),
    ]);

    const combined = [
      ...swAll.map(d => ({ ...d.toObject(), type: 'shadow_war' })),
      ...atAll.map(d => ({ ...d.toObject(), type: 'accursed_tower' })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = combined.length;
    return res.status(200).json({
      total, page, limit,
      pages: Math.ceil(total / limit),
      data: combined.slice(skip, skip + limit),
    });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
