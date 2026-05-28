const router    = require('express').Router();
const ShadowWar = require('../models/ShadowWar');
const Character = require('../models/Character');

const populate = (query) => query
  .populate('confirmed')
  .populate('enemyClan')
  .populate('battle.exalted.group1.character')
  .populate('battle.exalted.group2.character')
  .populate('battle.eminent.group1.character')
  .populate('battle.eminent.group2.character')
  .populate('battle.famed.group1.character')
  .populate('battle.famed.group2.character')
  .populate('battle.proud.group1.character')
  .populate('battle.proud.group2.character');

// GET /shadow-war/active?characterId=X
// Returns the active (non-completed) shadow war for the character's clan.
router.get('/active', async (req, res) => {
  try {
    const { characterId } = req.query;
    if (!characterId) return res.json(null);

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) return res.json(null);

    const now = new Date();
    let active = await populate(
      ShadowWar.findOne({ clan: char.clan, completed: { $ne: true }, date: { $gte: now } }).sort({ date: 1 })
    );
    if (!active) {
      active = await populate(
        ShadowWar.findOne({ clan: char.clan, completed: { $ne: true } }).sort({ date: -1 })
      );
    }
    return res.json(active ?? null);
  } catch (err) {
    return res.status(500).json({ message: 'Error al obtener la guerra sombría activa.', error: err.message });
  }
});

// PATCH /:id/confirm
router.patch('/:id/confirm', async (req, res) => {
  try {
    const { decodeToken } = require('../integrations/jwt');
    const User  = require('../models/User');
    const token = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No autorizado' });
    const decoded = await decodeToken(token);
    const user    = await User.findById(decoded.data.id);
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const charIds = (user.character ?? []).map(String);
    const sw      = await ShadowWar.findById(req.params.id);
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
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
