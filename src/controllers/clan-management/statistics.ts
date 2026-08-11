import { Router, type Request, type Response } from 'express';
import ShadowWar from '../../models/ShadowWar';
import AccursedTower from '../../models/AccursedTower';
import AttendanceCycle from '../../models/AttendanceCycle';
import { message } from '../../messages';
import type { IUser, MatchResult } from '../../types';
import { isSystemAdmin, getClanIdForCharacter } from '../../helpers/clanScope';
import { Types } from 'mongoose';

const router = Router();

type ClanId = Types.ObjectId | null | false;

async function resolveClanRead(user: IUser, characterId: string | undefined): Promise<ClanId> {
  if (isSystemAdmin(user)) {
    if (!characterId) return null;
    return await getClanIdForCharacter(characterId);
  }
  const charIds = user.character.map(String);
  if (!characterId || !charIds.includes(String(characterId))) return false;
  const clanId = await getClanIdForCharacter(characterId);
  return clanId ?? false;
}

const RESULTS = ['victory', 'defeat', 'draw'] as const;

interface ResultDoc { _id: unknown; date: Date; result?: MatchResult; enemyClan?: unknown }

function summarizeDocs(docs: ResultDoc[], includeMatches: boolean) {
  const counts = { victory: 0, defeat: 0, draw: 0, total: 0 };
  for (const doc of docs) {
    const r = doc.result;
    if (r === 'victory' || r === 'defeat' || r === 'draw') { counts[r]++; counts.total++; }
  }
  if (!includeMatches) return counts;
  const matches = docs.map(d => ({ _id: d._id, date: d.date, enemyClan: d.enemyClan, result: d.result }));
  return { ...counts, matches };
}

async function findInRange<T extends ResultDoc>(
  find: (filter: Record<string, unknown>) => { select: (f: string) => { populate: (f: string) => Promise<T[]> } },
  clanId: Types.ObjectId,
  since: Date | null,
  until: Date | null,
  includeMatches: boolean,
) {
  if (!since || !until) return summarizeDocs([], includeMatches);
  const docs = await find({ clan: clanId, date: { $gte: since, $lte: until }, result: { $in: RESULTS } })
    .select('date result enemyClan').populate('enemyClan');
  return summarizeDocs(docs, includeMatches);
}

const ACTIVITY_TYPES = ['shadow_war', 'accursed_tower'] as const;
type ActivityType = typeof ACTIVITY_TYPES[number];

router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, type } = req.query as { characterId?: string; type?: string };
    const range = (req.query.range as string) ?? '30';

    if (!type || !ACTIVITY_TYPES.includes(type as ActivityType)) {
      res.status(400).json({ message: "type debe ser 'shadow_war' o 'accursed_tower'." }); return;
    }

    const clanId = await resolveClanRead(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }

    const latestCycle = await AttendanceCycle.findOne({ clan: clanId, activityType: type }).sort({ startDate: -1 });

    let since: Date | null;
    let until: Date | null;
    let cycleUsed: typeof latestCycle | null = null;

    if (range === 'cycle') {
      if (latestCycle) {
        since = latestCycle.startDate;
        until = latestCycle.endDate;
        cycleUsed = latestCycle;
      } else {
        since = null;
        until = null;
      }
    } else {
      const days = parseInt(range, 10) || 30;
      until = new Date();
      since = new Date();
      since.setDate(until.getDate() - days);
    }

    const summary = type === 'shadow_war'
      ? await findInRange(f => ShadowWar.find(f), clanId, since, until, true)
      : await findInRange(f => AccursedTower.find(f), clanId, since, until, true);

    res.status(200).json({
      type,
      range,
      since,
      until,
      hasCycle: !!latestCycle,
      cycleUsed,
      ...summary,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
