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
      .populate('battle.exalted.group1.member')
      .populate('battle.exalted.group2.member')
      .populate('battle.eminent.group1.member')
      .populate('battle.eminent.group2.member')
      .populate('battle.famed.group1.member')
      .populate('battle.famed.group2.member')
      .populate('battle.proud.group1.member')
      .populate('battle.proud.group2.member');

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

module.exports = router;
