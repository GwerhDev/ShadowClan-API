import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import ShadowWar from '../../models/ShadowWar';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import Attendance from '../../models/Attendance';
import Cycle from '../../models/Cycle';
import { message } from '../../messages';
import type { IUser } from '../../types';
import { isSystemAdmin, getClanIdForCharacter, getClanForActiveChar } from '../../helpers/clanScope';

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

function parseDayStart(d: string): Date { return new Date(d + 'T00:00:00.000Z'); }
function parseDayEnd(d: string): Date { return new Date(d + 'T23:59:59.999Z'); }
function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_CYCLE_DAYS = 28; // 4 semanas
const MAX_CYCLE_DAYS = 49; // 7 semanas

// Cuenta de días inclusive entre dos 'YYYY-MM-DD' — ambos extremos cuentan
// (un ciclo del día X al X+27 dura exactamente 28 días / 4 semanas).
function inclusiveDayCount(startStr: string, endStr: string): number {
  const start = parseDayStart(startStr).getTime();
  const end   = parseDayStart(endStr).getTime();
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

// Solo llamar cuando hay un endDate real — un ciclo abierto no tiene restricción de duración.
function validateCycleDates(startStr: string, endStr: string): string | null {
  const days = inclusiveDayCount(startStr, endStr);
  if (days < 1) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
  if (days < MIN_CYCLE_DAYS || days > MAX_CYCLE_DAYS) {
    return `La duración del ciclo debe ser de entre ${MIN_CYCLE_DAYS / 7} y ${MAX_CYCLE_DAYS / 7} semanas (actual: ${days} días).`;
  }
  return null;
}

// Monday (UTC) of the ISO week that contains dateStr ('YYYY-MM-DD').
function mondayOf(dateStr: string): Date {
  const d = parseDayStart(dateStr);
  const day = d.getUTCDay(); // 0 = Sun ... 6 = Sat
  const diffToMonday = (day + 6) % 7; // Mon = 0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diffToMonday);
  return monday;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

async function getClanRoster(clanId: Types.ObjectId | string) {
  const clan = await Clan.findById(clanId).select('leader officer member');
  if (!clan) return [] as Array<{ _id: unknown; name: string; currentClass?: string; role: 'leader' | 'officer' | 'member' }>;

  const roleOrder: Record<string, number> = {};
  const roleLabel: Record<string, 'leader' | 'officer' | 'member'> = {};
  if (clan.leader) { const k = String(clan.leader); roleOrder[k] = 0; roleLabel[k] = 'leader'; }
  for (const o of clan.officer ?? []) { const k = String(o); roleOrder[k] = 1; roleLabel[k] = 'officer'; }
  for (const m of clan.member ?? []) { const k = String(m); roleOrder[k] = 2; roleLabel[k] = 'member'; }
  const allIds = Object.keys(roleLabel);

  const chars = await Character.find({ _id: { $in: allIds } }).select('name currentClass resonance score armor armorPenetration power resistance memberStatus').lean();
  chars.sort((a, b) => {
    const ra = roleOrder[String(a._id)] ?? 2;
    const rb = roleOrder[String(b._id)] ?? 2;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });

  return chars.map(c => ({ ...c, role: roleLabel[String(c._id)] ?? 'member' }));
}

// ── Attendance summary for all members of a clan (30/60/90/último ciclo) ────
router.get('/members-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(200).json({ hasCycle: false, cycleIsOpen: false, data: {} }); return; }

    const latestCycle = await Cycle.findOne({ clan: clanId, activityType: 'shadow' }).sort({ startDate: -1 });
    const hasCycle    = !!latestCycle;
    const cycleIsOpen = !!latestCycle && !latestCycle.endDate;

    const range = (req.query.range as string) ?? '30';
    let since: Date | null, until: Date | null;
    if (range === 'cycle') {
      since = latestCycle ? latestCycle.startDate : null;
      until = latestCycle ? (latestCycle.endDate ?? new Date()) : null;
    } else {
      const days = parseInt(range, 10) || 30;
      until = new Date();
      since = new Date();
      since.setDate(until.getDate() - days);
    }

    const clan = await Clan.findById(clanId).select('leader officer member');
    if (!clan) { res.status(200).json({ hasCycle, cycleIsOpen, data: {} }); return; }
    const allIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...(clan.officer ?? []).map(String),
      ...(clan.member  ?? []).map(String),
    ];
    if (!allIds.length) { res.status(200).json({ hasCycle, cycleIsOpen, data: {} }); return; }

    const shadowWars = since && until
      ? await ShadowWar.find({ clan: clanId, completed: true, date: { $gte: since, $lte: until } }).select('_id')
      : [];
    const swIds = shadowWars.map(sw => sw._id);
    const totalActivities = swIds.length;

    const data: Record<string, { percentage: number; attended: number; totalActivities: number }> = {};

    if (!swIds.length) {
      for (const id of allIds) data[id] = { percentage: 0, attended: 0, totalActivities: 0 };
      res.status(200).json({ hasCycle, cycleIsOpen, clanPercentage: 0, data }); return;
    }

    const records = await Attendance.find({
      shadowWar: { $in: swIds },
      character: { $in: allIds },
    }).select('character attended').lean();

    for (const id of allIds) {
      const memberRecs = records.filter(r => String(r.character) === id);
      const attended   = memberRecs.filter(r => r.attended).length;
      data[id] = { percentage: totalActivities ? Math.round((attended / totalActivities) * 100) : 0, attended, totalActivities };
    }

    const totalAttended = Object.values(data).reduce((sum, d) => sum + d.attended, 0);
    const totalPossible = Object.values(data).reduce((sum, d) => sum + d.totalActivities, 0);
    const clanPercentage = totalPossible ? Math.round((totalAttended / totalPossible) * 100) : 0;

    res.status(200).json({ hasCycle, cycleIsOpen, clanPercentage, data });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Attendance summary for a single member, with 30/60/90/último ciclo ─────
router.get('/member/:characterId/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }

    const targetId = req.params.characterId;
    const target = await Character.findById(targetId).select('clan');
    if (!target || String(target.clan) !== String(clanId)) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }

    const range = (req.query.range as string) ?? '30';
    const latestCycle = await Cycle.findOne({ clan: clanId, activityType: 'shadow' }).sort({ startDate: -1 });

    let since: Date | null, until: Date | null;
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
      ? await ShadowWar.find({ clan: clanId, completed: true, date: { $gte: since, $lte: until } }).select('_id')
      : [];
    const swIds = shadowWars.map(sw => sw._id);
    const totalActivities = swIds.length;

    const records = swIds.length
      ? await Attendance.find({ shadowWar: { $in: swIds }, character: targetId }).select('attended')
      : [];
    const attended = records.filter(r => r.attended).length;
    const missed   = records.filter(r => !r.attended).length;
    const unmarked = totalActivities - records.length;
    const percentage = totalActivities ? Math.round((attended / totalActivities) * 100) : 0;

    res.status(200).json({
      range,
      hasCycle: !!latestCycle,
      cycleIsOpen: !!latestCycle && !latestCycle.endDate,
      totalActivities, attended, missed, unmarked, percentage,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Attendance for a single Shadow War ──────────────────────────────────────

router.get('/shadow-war/:shadowWarId', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await ShadowWar.findById(req.params.shadowWarId).select('date enemyClan result clan').populate('enemyClan');
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(sw.clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    const roster  = sw.clan ? await getClanRoster(sw.clan) : [];
    const records = await Attendance.find({ shadowWar: sw._id }).select('character attended');
    const attendedMap = new Map(records.map(r => [String(r.character), r.attended]));
    const members = roster.map(m => ({
      ...m,
      attended: attendedMap.has(String(m._id)) ? (attendedMap.get(String(m._id)) as boolean) : null,
    }));
    res.status(200).json({
      shadowWar: { _id: sw._id, date: sw.date, enemyClan: sw.enemyClan, result: sw.result },
      members,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/shadow-war/:shadowWarId/members/:memberId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, attended } = req.body as { characterId?: string; attended?: boolean };
    if (typeof attended !== 'boolean') { res.status(400).json({ message: 'attended (boolean) requerido.' }); return; }

    const sw = await ShadowWar.findById(req.params.shadowWarId).select('date clan');
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }

    const clanId = await getClanForActiveChar(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (clanId && String(sw.clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }

    const record = await Attendance.findOneAndUpdate(
      { shadowWar: sw._id, character: req.params.memberId },
      { attended, clan: sw.clan, date: sw.date, markedBy: req.user!._id },
      { upsert: true, new: true },
    );
    res.status(200).json({ character: req.params.memberId, attended: record.attended });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Weekly attendance view (jueves + sábado) ────────────────────────────────

const WEEK_DAYS = [
  { key: 'thursday', label: 'Jueves', offset: 3 },
  { key: 'saturday', label: 'Sábado', offset: 5 },
] as const;

router.get('/week', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }

    const refDate = (req.query.date as string) || toDateStr(new Date());
    const monday  = mondayOf(refDate);

    const { q, page: rawPage, limit: rawLimit } = req.query as Record<string, string>;
    const page  = Math.max(1, parseInt(rawPage  ?? '1',  10));
    const limit = Math.min(50, Math.max(1, parseInt(rawLimit ?? '20', 10)));

    let roster = await getClanRoster(clanId);
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      roster = roster.filter(m => m.name.toLowerCase().includes(needle));
    }
    const total      = roster.length;
    const pageRoster = roster.slice((page - 1) * limit, page * limit);

    const days: Array<{ key: string; label: string; date: string; shadowWar: unknown }> = [];
    const attendanceByDay: Record<string, Map<string, boolean>> = {};

    for (const wd of WEEK_DAYS) {
      const dayDate = addDays(monday, wd.offset);
      const dayStr  = toDateStr(dayDate);
      const start   = parseDayStart(dayStr);
      const end     = parseDayEnd(dayStr);
      const sw = await ShadowWar.findOne({ clan: clanId, date: { $gte: start, $lte: end } })
        .select('date enemyClan result').populate('enemyClan');

      let attendanceMap = new Map<string, boolean>();
      if (sw) {
        const records = await Attendance.find({ shadowWar: sw._id }).select('character attended');
        attendanceMap = new Map(records.map(r => [String(r.character), r.attended]));
      }
      attendanceByDay[wd.key] = attendanceMap;
      days.push({
        key: wd.key,
        label: wd.label,
        date: dayStr,
        shadowWar: sw ? { _id: sw._id, date: sw.date, enemyClan: sw.enemyClan, result: sw.result } : null,
      });
    }

    const members = pageRoster.map(m => ({
      ...m,
      attendance: Object.fromEntries(WEEK_DAYS.map(wd => {
        const map = attendanceByDay[wd.key];
        return [wd.key, map.has(String(m._id)) ? (map.get(String(m._id)) as boolean) : null];
      })),
    }));

    res.status(200).json({
      weekStart: toDateStr(monday),
      days,
      members,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Attendance cycles (rango de fechas para analizar participación) ────────

const CYCLE_ACTIVITY_TYPES = ['shadow', 'immortal'] as const;

router.get('/cycles', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const activityType = req.query.activityType as string | undefined;
    const filter: Record<string, unknown> = clanId ? { clan: clanId } : {};
    if (activityType && CYCLE_ACTIVITY_TYPES.includes(activityType as typeof CYCLE_ACTIVITY_TYPES[number])) {
      filter.activityType = activityType;
    }
    const total = await Cycle.countDocuments(filter);
    const data  = await Cycle.find(filter).sort({ startDate: -1 }).skip((page - 1) * limit).limit(limit);
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/cycles', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, startDate, endDate, activityType } = req.body as { characterId?: string; startDate?: string; endDate?: string; activityType?: string };
    const clanId = await getClanForActiveChar(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }
    if (!startDate) { res.status(400).json({ message: 'startDate es requerido.' }); return; }
    if (!activityType || !CYCLE_ACTIVITY_TYPES.includes(activityType as typeof CYCLE_ACTIVITY_TYPES[number])) {
      res.status(400).json({ message: "activityType debe ser 'shadow' o 'immortal'." }); return;
    }
    if (endDate) {
      const err = validateCycleDates(startDate, endDate);
      if (err) { res.status(400).json({ message: err }); return; }
    }

    const cycle = await new Cycle({
      clan: clanId,
      activityType,
      startDate: parseDayStart(startDate),
      endDate: endDate ? parseDayEnd(endDate) : undefined,
      createdBy: req.user!._id,
    }).save();
    res.status(201).json(cycle);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, startDate, endDate, activityType } = req.body as { characterId?: string; startDate?: string; endDate?: string; activityType?: string };
    const cycle = await Cycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, characterId);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }

    // Validar contra el estado final fusionado (los campos no tocados conservan su valor actual),
    // antes de mutar el doc — cubre cerrar un ciclo abierto y editar start/end de uno ya cerrado.
    const finalStartStr   = startDate !== undefined ? startDate : toDateStr(cycle.startDate);
    const willHaveEndDate = endDate !== undefined ? !!endDate : !!cycle.endDate;
    if (willHaveEndDate) {
      const finalEndStr = endDate !== undefined ? endDate : toDateStr(cycle.endDate as Date);
      const err = validateCycleDates(finalStartStr, finalEndStr);
      if (err) { res.status(400).json({ message: err }); return; }
    }

    if (startDate !== undefined) cycle.startDate = parseDayStart(startDate);
    if (endDate !== undefined && endDate) cycle.endDate = parseDayEnd(endDate);
    if (activityType !== undefined && CYCLE_ACTIVITY_TYPES.includes(activityType as typeof CYCLE_ACTIVITY_TYPES[number])) {
      cycle.activityType = activityType as typeof CYCLE_ACTIVITY_TYPES[number];
    }
    await cycle.save();
    res.status(200).json(cycle);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = await Cycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    await Cycle.findByIdAndDelete(req.params.cycleId);
    res.status(200).json({ message: 'Cycle deleted' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Cycle report: participación de cada miembro en el rango del ciclo ──────

router.get('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = await Cycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    if (cycle.activityType !== 'shadow') {
      res.status(400).json({ message: 'El reporte de asistencia solo está disponible para ciclos de Guerra Sombría.' }); return;
    }

    const reportUntil = cycle.endDate ?? new Date();
    const shadowWars = await ShadowWar.find({ clan: cycle.clan, completed: true, date: { $gte: cycle.startDate, $lte: reportUntil } })
      .select('date enemyClan result').populate('enemyClan').sort({ date: 1 });
    const swIds = shadowWars.map(sw => sw._id);
    const totalActivities = shadowWars.length;

    const roster  = await getClanRoster(cycle.clan);
    const records = swIds.length ? await Attendance.find({ shadowWar: { $in: swIds } }).select('character attended') : [];

    const members = roster.map(m => {
      const memberRecords = records.filter(r => String(r.character) === String(m._id));
      const attendedCount  = memberRecords.filter(r => r.attended).length;
      const markedCount    = memberRecords.length;
      const percentage     = totalActivities ? Math.round((attendedCount / totalActivities) * 100) : 0;
      return { ...m, attendedCount, markedCount, totalActivities, percentage };
    }).sort((a, b) => b.percentage - a.percentage);

    res.status(200).json({ cycle, shadowWars, members });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
