import { Router, type Request, type Response } from 'express';
import ShadowWar from '../../models/ShadowWar';
import AccursedTower from '../../models/AccursedTower';
import Cycle from '../../models/Cycle';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
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
  find: (filter: Record<string, unknown>) => { select: (f: string) => { populate: (f: string, p: string) => Promise<T[]> } },
  clanId: Types.ObjectId,
  since: Date | null,
  until: Date | null,
  includeMatches: boolean,
) {
  if (!since || !until) return summarizeDocs([], includeMatches);
  const docs = await find({ clan: clanId, date: { $gte: since, $lte: until }, result: { $in: RESULTS } })
    .select('date result enemyClan').populate('enemyClan', 'name');
  return summarizeDocs(docs, includeMatches);
}

const ACTIVITY_TYPES = ['shadow_war', 'accursed_tower'] as const;
type ActivityType = typeof ACTIVITY_TYPES[number];

router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, type } = req.query as { characterId?: string; type?: string };
    const range = (req.query.range as string) ?? '30';
    const includeMatches = req.query.includeMatches === 'true';

    if (!type || !ACTIVITY_TYPES.includes(type as ActivityType)) {
      res.status(400).json({ message: "type debe ser 'shadow_war' o 'accursed_tower'." }); return;
    }

    const clanId = await resolveClanRead(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }

    const latestCycle = await Cycle.findOne({ clan: clanId, activityType: type }).sort({ startDate: -1 });

    let since: Date | null;
    let until: Date | null;
    let cycleUsed: typeof latestCycle | null = null;

    if (range === 'cycle') {
      if (latestCycle) {
        since = latestCycle.startDate;
        until = latestCycle.endDate ?? new Date();
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
      ? await findInRange(f => ShadowWar.find(f), clanId, since, until, includeMatches)
      : await findInRange(f => AccursedTower.find(f), clanId, since, until, includeMatches);

    res.status(200).json({
      type,
      range,
      since,
      until,
      hasCycle: !!latestCycle,
      cycleIsOpen: !!latestCycle && !latestCycle.endDate,
      cycleUsed,
      ...summary,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Overview summary: roster count + class breakdown + next activities ─────
// Diseñado para devolver solo lo que el Overview necesita, sin exponer stats,
// contacto (whatsapp) ni el roster/alineaciones del clan enemigo.

router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }

    const clan = await Clan.findById(clanId).select('leader officer member updatedAt');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const rosterIds = [
      ...(clan.leader ? [clan.leader] : []),
      ...(clan.officer ?? []),
      ...(clan.member ?? []),
    ];
    const memberCount = rosterIds.length;

    const rosterChars = rosterIds.length
      ? await Character.find({ _id: { $in: rosterIds } }).select('currentClass').lean()
      : [];
    const classCounts: Record<string, number> = {};
    for (const c of rosterChars) {
      const key = c.currentClass || 'unknown';
      classCounts[key] = (classCounts[key] ?? 0) + 1;
    }

    const now = new Date();

    const swBase = { clan: clanId, completed: { $ne: true } };
    let nextShadowWar = await ShadowWar.findOne({ ...swBase, date: { $gte: now } })
      .select('date enemyClan').populate('enemyClan', 'name').sort({ date: 1 });
    if (!nextShadowWar) {
      nextShadowWar = await ShadowWar.findOne(swBase).select('date enemyClan').populate('enemyClan', 'name').sort({ date: -1 });
    }

    const atBase = { clan: clanId, active: true, completed: { $ne: true } };
    let nextAccursedTower = await AccursedTower.findOne({ ...atBase, date: { $gte: now } })
      .select('date enemyClan').populate('enemyClan', 'name').sort({ date: 1 });
    if (!nextAccursedTower) {
      nextAccursedTower = await AccursedTower.findOne(atBase).select('date enemyClan').populate('enemyClan', 'name').sort({ date: -1 });
    }

    const cyclesTotal = await Cycle.countDocuments({ clan: clanId });

    res.status(200).json({
      memberCount,
      clanUpdatedAt: clan.updatedAt,
      classCounts,
      nextShadowWar: nextShadowWar ? { date: nextShadowWar.date, enemyClan: nextShadowWar.enemyClan } : null,
      nextAccursedTower: nextAccursedTower ? { date: nextAccursedTower.date, enemyClan: nextAccursedTower.enemyClan } : null,
      cyclesTotal,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
