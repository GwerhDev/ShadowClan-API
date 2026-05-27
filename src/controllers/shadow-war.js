const router = require("express").Router();
const ShadowWar = require('../models/ShadowWar');
const { timezoneOffset } = require('../config');

router.get('/next', async (req, res) => {
  try {
    const serverNow = new Date();
    const today = new Date(serverNow.getTime() + timezoneOffset * 60 * 60 * 1000);
    const now = new Date(serverNow.getTime() + timezoneOffset * 60 * 60 * 1000);

    const getNextDayOfWeek = (date, dayOfWeek) => {
      const resultDate = new Date(date.getTime());
      const daysUntil = (dayOfWeek - resultDate.getUTCDay() + 7) % 7;
      resultDate.setUTCDate(resultDate.getUTCDate() + daysUntil);
      return resultDate;
    };

    let nextThursday = getNextDayOfWeek(today, 4); // 4 = Thursday
    nextThursday.setUTCHours(22, 0, 0, 0); // User's requested cutoff time

    let nextSaturday = getNextDayOfWeek(today, 6); // 6 = Saturday
    nextSaturday.setUTCHours(19, 30, 0, 0); // Keep original time for Saturday

    if (nextThursday < now) {
      nextThursday.setUTCDate(nextThursday.getUTCDate() + 7);
    }

    if (nextSaturday < now) {
      nextSaturday.setUTCDate(nextSaturday.getUTCDate() + 7);
    }

    const nextBattleDate = nextThursday < nextSaturday ? nextThursday : nextSaturday;

    const nextBattleDateUTC = new Date(nextBattleDate.getTime() - timezoneOffset * 60 * 60 * 1000);

    let nextBattle = await ShadowWar.findOne({
      date: {
        $gte: nextBattleDateUTC,
        $lt: new Date(nextBattleDateUTC.getTime() + 24 * 60 * 60 * 1000),
      },
    })
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

    if (!nextBattle) {
      const newShadowWar = new ShadowWar({
        date: nextBattleDateUTC,
        enemyClan: null,
        confirmed: [],
        battle: {
          exalted: [{ grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }],
          eminent: [{ grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }],
          famed: [{ grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }],
          proud: [{ grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }, { grupo1: [], group2: [], result: "pending" }],
        },
        result: "pending"
      });
      await newShadowWar.save();
      nextBattle = newShadowWar;
    }

    res.json(nextBattle);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener la próxima Shadow War.', error });
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
