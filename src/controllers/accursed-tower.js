const router        = require('express').Router();
const AccursedTower = require('../models/AccursedTower');
const Character     = require('../models/Character');

const populate = (query) => query
  .populate('enemyClan')
  .populate('roster.group1')
  .populate('roster.group2')
  .populate('roster.group3');

// GET /accursed-tower/active?characterId=X
// Returns active (non-completed) towers for the character's clan.
router.get('/active', async (req, res) => {
  try {
    const { characterId } = req.query;
    if (!characterId) return res.json([]);

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) return res.json([]);

    const filter = { clan: char.clan, completed: { $ne: true } };
    const now    = new Date();

    let towers = await populate(
      AccursedTower.find({ ...filter, date: { $gte: now } }).sort({ date: 1 })
    );
    if (!towers.length) {
      towers = await populate(AccursedTower.find(filter).sort({ date: -1 }));
    }
    return res.json(towers);
  } catch (err) {
    return res.status(500).json({ message: 'Error al obtener torres activas.', error: err.message });
  }
});

// PATCH /accursed-tower/:id/confirm — member confirms participation
router.patch('/:id/confirm', async (req, res) => {
  try {
    const { decodeToken } = require('../integrations/jwt');
    const User  = require('../models/User');
    const token = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No autorizado' });
    const decoded = await decodeToken(token);
    const user    = await User.findById(decoded.data.id);
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { characterId } = req.body;
    const charIds = (user.character ?? []).map(String);
    const charId  = characterId && charIds.includes(String(characterId))
      ? String(characterId) : charIds[0];

    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) return res.status(404).json({ message: 'Torre no encontrada.' });

    const already = new Set((tower.confirmed ?? []).map(String));
    if (!already.has(charId)) { tower.confirmed.push(charId); await tower.save(); }
    return res.status(200).json({ message: 'Participación confirmada.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
