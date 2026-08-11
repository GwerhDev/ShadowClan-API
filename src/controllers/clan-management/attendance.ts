import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import ShadowWar from '../../models/ShadowWar';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import Attendance from '../../models/Attendance';
import AttendanceCycle from '../../models/AttendanceCycle';
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

  const chars = await Character.find({ _id: { $in: allIds } }).select('name currentClass').lean();
  chars.sort((a, b) => {
    const ra = roleOrder[String(a._id)] ?? 2;
    const rb = roleOrder[String(b._id)] ?? 2;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });

  return chars.map(c => ({ ...c, role: roleLabel[String(c._id)] ?? 'member' }));
}

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

    const roster = await getClanRoster(clanId);
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

    const members = roster.map(m => ({
      ...m,
      attendance: Object.fromEntries(WEEK_DAYS.map(wd => {
        const map = attendanceByDay[wd.key];
        return [wd.key, map.has(String(m._id)) ? (map.get(String(m._id)) as boolean) : null];
      })),
    }));

    res.status(200).json({ weekStart: toDateStr(monday), days, members });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Attendance cycles (rango de fechas para analizar participación) ────────

const CYCLE_ACTIVITY_TYPES = ['shadow_war', 'accursed_tower'] as const;

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
    const total = await AttendanceCycle.countDocuments(filter);
    const data  = await AttendanceCycle.find(filter).sort({ startDate: -1 }).skip((page - 1) * limit).limit(limit);
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/cycles', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, name, startDate, endDate, activityType } = req.body as { characterId?: string; name?: string; startDate?: string; endDate?: string; activityType?: string };
    const clanId = await getClanForActiveChar(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }
    if (!name?.trim() || !startDate || !endDate) { res.status(400).json({ message: 'name, startDate y endDate son requeridos.' }); return; }
    if (!activityType || !CYCLE_ACTIVITY_TYPES.includes(activityType as typeof CYCLE_ACTIVITY_TYPES[number])) {
      res.status(400).json({ message: "activityType debe ser 'shadow_war' o 'accursed_tower'." }); return;
    }

    const cycle = await new AttendanceCycle({
      clan: clanId,
      activityType,
      name: name.trim(),
      startDate: parseDayStart(startDate),
      endDate: parseDayEnd(endDate),
      createdBy: req.user!._id,
    }).save();
    res.status(201).json(cycle);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, name, startDate, endDate, activityType } = req.body as { characterId?: string; name?: string; startDate?: string; endDate?: string; activityType?: string };
    const cycle = await AttendanceCycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, characterId);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    if (name !== undefined) cycle.name = name.trim();
    if (startDate !== undefined) cycle.startDate = parseDayStart(startDate);
    if (endDate !== undefined) cycle.endDate = parseDayEnd(endDate);
    if (activityType !== undefined && CYCLE_ACTIVITY_TYPES.includes(activityType as typeof CYCLE_ACTIVITY_TYPES[number])) {
      cycle.activityType = activityType as typeof CYCLE_ACTIVITY_TYPES[number];
    }
    await cycle.save();
    res.status(200).json(cycle);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = await AttendanceCycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    await AttendanceCycle.findByIdAndDelete(req.params.cycleId);
    res.status(200).json({ message: 'Cycle deleted' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Cycle report: participación de cada miembro en el rango del ciclo ──────

router.get('/cycles/:cycleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const cycle = await AttendanceCycle.findById(req.params.cycleId);
    if (!cycle) { res.status(404).json({ message: 'Cycle not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(cycle.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    if (cycle.activityType !== 'shadow_war') {
      res.status(400).json({ message: 'El reporte de asistencia solo está disponible para ciclos de Guerra Sombría.' }); return;
    }

    const shadowWars = await ShadowWar.find({ clan: cycle.clan, date: { $gte: cycle.startDate, $lte: cycle.endDate } })
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
