const router        = require('express').Router();
const ShadowWar     = require('../../models/ShadowWar');
const AccursedTower = require('../../models/AccursedTower');
const Character     = require('../../models/Character');
const { message }   = require('../../messages');

const isAdmin = (user) => user?.role === 'admin' || user?.role === 'super_admin';

// GET /clan-management/history?characterId=&type=all|shadow_war|accursed_tower&page=1
router.get('/', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;
    const type  = req.query.type || 'all';

    let clanFilter = {};
    if (!isAdmin(req.user)) {
      const { characterId } = req.query;
      if (!characterId) return res.status(200).json({ total: 0, page, limit, pages: 0, data: [] });
      const char = await Character.findById(characterId).select('clan');
      if (!char?.clan) return res.status(200).json({ total: 0, page, limit, pages: 0, data: [] });
      clanFilter = { clan: char.clan };
    }

    if (type === 'shadow_war') {
      const total = await ShadowWar.countDocuments(clanFilter);
      const data  = await ShadowWar.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      return res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'shadow_war' })) });
    }

    if (type === 'accursed_tower') {
      const total = await AccursedTower.countDocuments(clanFilter);
      const data  = await AccursedTower.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      return res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'accursed_tower' })) });
    }

    const [swAll, atAll] = await Promise.all([
      ShadowWar.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
      AccursedTower.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
    ]);
    const combined = [
      ...swAll.map(d => ({ ...d.toObject(), type: 'shadow_war' })),
      ...atAll.map(d => ({ ...d.toObject(), type: 'accursed_tower' })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({ total: combined.length, page, limit, pages: Math.ceil(combined.length / limit), data: combined.slice(skip, skip + limit) });
  } catch (err) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
