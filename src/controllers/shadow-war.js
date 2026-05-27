const router = require("express").Router();
const ShadowWar = require('../models/ShadowWar');

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

// GET /shadow-war/next — returns the nearest upcoming non-completed shadow war, or null if none
router.get('/next', async (req, res) => {
  try {
    const now = new Date();
    const baseFilter = { completed: { $ne: true } };

    let nextBattle = await populate(
      ShadowWar.findOne({ ...baseFilter, date: { $gte: now } }).sort({ date: 1 })
    );

    // If no upcoming, fall back to the most recent past non-completed one
    if (!nextBattle) {
      nextBattle = await populate(
        ShadowWar.findOne(baseFilter).sort({ date: -1 })
      );
    }

    return res.json(nextBattle ?? null);
  } catch (error) {
    return res.status(500).json({ message: 'Error al obtener la próxima Shadow War.', error });
  }
});

router.patch('/:id/confirm', async (req, res) => {
  try {
    const { decodeToken } = require('../integrations/jwt');
    const User = require('../models/User');
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!userToken) return res.status(401).json({ message: 'No autorizado' });
    const decoded = await decodeToken(userToken);
    const user = await User.findById(decoded.data.id);
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const charIds = (user.character ?? []).map(String);
    const shadowWar = await ShadowWar.findById(req.params.id);
    if (!shadowWar) return res.status(404).json({ message: 'Shadow War not found' });

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
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
