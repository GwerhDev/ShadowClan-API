import { Router, type Request, type Response } from 'express';
import Character from '../models/Character';
import ShadowWar from '../models/ShadowWar';
import Attendance from '../models/Attendance';
import Cycle from '../models/Cycle';

const router = Router();

router.get('/character/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!; // ya resuelto por authorizeRoles en routes/index.ts
    const characterId = String(req.params.characterId);
    if (!user.character.map(String).includes(characterId)) {
      res.status(403).json({ message: 'El personaje no te pertenece.' }); return;
    }

    const range = (req.query.range as string) ?? '30';
    const char = await Character.findById(characterId).select('clan');
    const empty = { totalActivities: 0, attended: 0, missed: 0, unmarked: 0, percentage: 0 };
    if (!char?.clan) { res.status(200).json({ range, hasCycle: false, ...empty }); return; }

    const latestCycle = await Cycle.findOne({ clan: char.clan, activityType: 'shadow_war' }).sort({ startDate: -1 });

    let since: Date | null;
    let until: Date | null;
    if (range === 'cycle') {
      since = latestCycle ? latestCycle.startDate : null;
      until = latestCycle ? (latestCycle.endDate ?? new Date()) : null;
    } else {
      const days = parseInt(range, 10) || 30;
      until = new Date();
      since = new Date();
      since.setDate(until.getDate() - days);
    }

    const shadowWars = since && until
      ? await ShadowWar.find({ clan: char.clan, date: { $gte: since, $lte: until } }).select('_id')
      : [];
    const swIds = shadowWars.map(sw => sw._id);
    const totalActivities = swIds.length;

    const records = swIds.length
      ? await Attendance.find({ shadowWar: { $in: swIds }, character: characterId }).select('attended')
      : [];
    const attended = records.filter(r => r.attended).length;
    const missed   = records.filter(r => !r.attended).length;
    const unmarked = totalActivities - records.length;
    const percentage = totalActivities ? Math.round((attended / totalActivities) * 100) : 0;

    res.status(200).json({ range, since, until, hasCycle: !!latestCycle, totalActivities, attended, missed, unmarked, percentage });
  } catch { res.status(500).json({ error: 'Error al obtener la participación.' }); }
});

export default router;
