import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { Types } from 'mongoose';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import { message } from '../../messages';
import { calcScore } from '../../helpers/score';
import ShadowWar from '../../models/ShadowWar';
import Attendance from '../../models/Attendance';
import { openMembership, closeMembership, updateOpenRole } from '../../helpers/clanMembership';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CLASS_MAP: Record<string, string> = {
  'druida': 'druid',
  'bárbaro': 'barbarian', 'barbaro': 'barbarian',
  'caballero de sangre': 'bloodknight', 'caballero sangriento': 'bloodknight',
  'guerrero divino': 'crusader',
  'cazador de demonios': 'demonhunter',
  'monje': 'monk',
  'nigromante': 'necromancer',
  'tempest': 'tempest',
  'arcanista': 'wizard',
  'conjurador': 'warlock',
};
const VALID_CLASS_VALUES = new Set(Object.values(CLASS_MAP));

function resolveClass(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const key = String(raw).trim().toLowerCase();
  return CLASS_MAP[key] ?? (VALID_CLASS_VALUES.has(key) ? key : undefined);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return isNaN(n) || v === '' || v === null || v === undefined ? undefined : n;
}

// ── Attendance import helpers ─────────────────────────────────────────────────
const MONTH_MAP_ADMIN: Record<string, number> = {
  ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12
};
const NON_DATE_COLS_ADMIN = new Set(['Rank','Jugador','Armadura','Penetracion','Potencia','Resistencia','Resonancia','Score','Clase','Whatsapp','Observaciones','Asist']);

function parseDateColAdmin(col: string, year: number): string | null {
  const m = col.match(/^(\d{1,2})([a-z]+)$/i);
  if (!m) return null;
  const month = MONTH_MAP_ADMIN[m[2].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[1], 10);
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

async function buildSwByDateAdmin(rows: Record<string, unknown>[], clanId: unknown): Promise<Map<string, any>> {
  const year    = new Date().getFullYear();
  const allCols = rows.length ? Object.keys(rows[0]) : [];
  const dateCols = allCols.filter(c => !NON_DATE_COLS_ADMIN.has(c) && parseDateColAdmin(c, year) !== null);
  const map     = new Map<string, any>();
  for (const col of dateCols) {
    const dateStr = parseDateColAdmin(col, year)!;
    const start   = new Date(dateStr + 'T00:00:00.000Z');
    const end     = new Date(dateStr + 'T23:59:59.999Z');
    const sw      = await ShadowWar.findOne({ clan: clanId, date: { $gte: start, $lte: end } }).select('_id date clan');
    map.set(col, sw ?? null);
  }
  return map;
}

async function upsertAttendanceAdmin(
  row: Record<string, unknown>,
  characterId: unknown,
  clanId: unknown,
  swByDate: Map<string, any>,
): Promise<void> {
  for (const [col, sw] of swByDate) {
    if (!sw || Number(row[col]) !== 1) continue;
    await Attendance.findOneAndUpdate(
      { shadowWar: sw._id, character: characterId },
      { attended: true, clan: clanId, date: sw.date, activityType: 'shadow_war' },
      { upsert: true },
    );
  }
}

const router = Router();
const STATUS_ORDER: Record<string, number> = { claimed: 0, pending: 1, unclaimed: 2 };

async function getClansSorted(query: Record<string, unknown> = {}, { page = 1, limit = 20 } = {}) {
  const clans = await Clan.find(query).limit(limit).skip((page - 1) * limit).populate('leader').lean();
  return clans
    .sort((a, b) => (STATUS_ORDER[a.status ?? ''] ?? 3) - (STATUS_ORDER[b.status ?? ''] ?? 3))
    .map(clan => ({
      ...clan,
      totalMembers: (() => {
        const leaderId = clan.leader
          ? String((clan.leader as unknown as { _id?: unknown })?._id ?? clan.leader)
          : null;
        const members = (clan.member ?? []).filter(m => String(m) !== leaderId);
        return (leaderId ? 1 : 0) + (clan.officer?.length ?? 0) + members.length;
      })(),
    }));
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // Ensure leader is never duplicated in member[] (self-healing for legacy data)
    await Clan.updateMany(
      { leader: { $exists: true, $ne: null }, $expr: { $in: ['$leader', '$member'] } },
      [{ $set: { member: { $filter: { input: '$member', cond: { $ne: ['$$this', '$leader'] } } } } }],
    ).catch(() => { /* non-critical, never break the response */ });

    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    const pageNum  = Math.max(1, parseInt(page  ?? '1',  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10)));
    const query    = q?.trim() ? { name: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const total    = await Clan.countDocuments(query);
    const data     = await getClansSorted(query, { page: pageNum, limit: limitNum });
    res.status(200).json({ data, total, page: pageNum, limit: limitNum, hasMore: pageNum * limitNum < total });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id)
      .populate('leader',  'name currentClass resonance status armor armorPenetration power resistance')
      .populate('officer', 'name currentClass resonance status armor armorPenetration power resistance')
      .populate('member',  'name currentClass resonance status armor armorPenetration power resistance');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    res.status(200).json(clan);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    await new Clan({ name }).save();
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { _id, leader, officer, member } = req.body as { _id?: string; leader?: string; officer?: string[]; member?: string[] };
    const prevClan    = await Clan.findById(_id).select('leader officer member');
    const updatedClan = await Clan.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updatedClan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const repairs: Promise<unknown>[] = [];
    const newLeader = leader ? String(leader) : null;
    if (newLeader && newLeader !== (prevClan?.leader ? String(prevClan.leader) : null)) {
      repairs.push(Character.findByIdAndUpdate(newLeader, { clan: _id }));
    }
    for (const charId of [...new Set([...(officer ?? []).map(String), ...(member ?? []).map(String)])]) {
      repairs.push(Character.findByIdAndUpdate(charId, { clan: _id }));
    }
    if (repairs.length) await Promise.allSettled(repairs);
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id/leader', async (req: Request, res: Response): Promise<void> => {
  try {
    const { leaderId } = req.body as { leaderId?: string };
    if (!leaderId) { res.status(400).json({ message: 'leaderId requerido.' }); return; }

    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const prevLeaderId = clan.leader ? String(clan.leader) : null;
    const newLeaderId  = String(leaderId);

    if (prevLeaderId === newLeaderId) { res.status(200).json(await getClansSorted()); return; }

    // Remove new leader from officer/member arrays if present
    clan.officer = clan.officer.filter(o => String(o) !== newLeaderId);
    clan.member  = clan.member.filter(m => String(m) !== newLeaderId);

    // Previous leader → becomes a member (if not already)
    if (prevLeaderId) {
      const alreadyMember = clan.member.some(m => String(m) === prevLeaderId);
      const isOfficer     = clan.officer.some(o => String(o) === prevLeaderId);
      if (!alreadyMember && !isOfficer) {
        clan.member.push(clan.leader!);
      }
    }

    clan.leader = new (await import('mongoose')).Types.ObjectId(newLeaderId) as unknown as typeof clan.leader;
    await clan.save();

    // Repair Character.clan for the new leader
    await Character.findByIdAndUpdate(newLeaderId, { clan: clan._id });

    res.status(200).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id/leader', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    clan.leader = undefined;
    await clan.save();
    res.status(200).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Paginated members list ────────────────────────────────────────────────────
router.get('/:id/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const { q, page: rawPage, limit: rawLimit } = req.query as Record<string, string>;
    const page  = Math.max(1, parseInt(rawPage  ?? '1',  10));
    const limit = Math.min(50, Math.max(1, parseInt(rawLimit ?? '20', 10)));

    const roleOrder: Record<string, number> = {};
    const roleLabel: Record<string, 'leader' | 'officer' | 'member'> = {};
    if (clan.leader) { const k = String(clan.leader); roleOrder[k] = 0; roleLabel[k] = 'leader'; }
    for (const o of clan.officer ?? []) { const k = String(o); roleOrder[k] = 1; roleLabel[k] = 'officer'; }
    for (const m of clan.member  ?? []) { const k = String(m); roleOrder[k] = 2; roleLabel[k] = 'member'; }
    const allIds = Object.keys(roleLabel);

    const filter: Record<string, unknown> = { _id: { $in: allIds } };
    if (q?.trim()) filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };

    const chars = await Character.find(filter).select('name currentClass resonance memberStatus status armor armorPenetration power resistance').lean();

    chars.sort((a, b) => {
      const ra = roleOrder[String(a._id)] ?? 2;
      const rb = roleOrder[String(b._id)] ?? 2;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });

    const total  = chars.length;
    const sliced = chars.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      total,
      page,
      limit,
      hasMore: page * limit < total,
      members: sliced.map(c => ({ ...c, role: roleLabel[String(c._id)] ?? 'member' })),
    });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Sync clan membership from CSV / XLSX (admin, overwrites member[]) ─────────
router.post('/:id/sync', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ message: 'No se recibió ningún archivo.' }); return; }

    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    // Preload leader + officer characters by ID for reliable name-based matching
    const privilegedIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...(clan.officer ?? []).map(String),
    ];
    const privilegedChars = privilegedIds.length
      ? await Character.find({ _id: { $in: privilegedIds } }).select('_id name')
      : [];
    const privilegedByName = new Map(
      privilegedChars.map(c => [c.name.trim().toLowerCase(), String(c._id)])
    );

    type SyncResult = { name: string; status: 'created' | 'updated' };
    const results: SyncResult[]          = [];
    const newMemberIds: Types.ObjectId[] = [];
    const swByDate = await buildSwByDateAdmin(rows, clan._id);

    for (const row of rows) {
      const rawName = String(row['Jugador'] ?? '').trim();
      if (!rawName) continue;

      const data: Record<string, unknown> = {};
      const res2 = num(row['Resonancia']);   if (res2  !== undefined) data.resonance        = res2;
      const arm  = num(row['Armadura']);     if (arm   !== undefined) data.armor             = arm;
      const pen  = num(row['Penetracion']); if (pen   !== undefined) data.armorPenetration  = pen;
      const pow  = num(row['Potencia']);     if (pow   !== undefined) data.power             = pow;
      const res3 = num(row['Resistencia']); if (res3  !== undefined) data.resistance        = res3;
      const cls  = resolveClass(row['Clase']); if (cls !== undefined) data.currentClass     = cls;
      const wa   = row['Whatsapp'];          if (wa && String(wa).trim()) data.whatsapp     = String(wa).trim();

      // Leader/officer: update stats only, never add to member[]
      const privilegedId = privilegedByName.get(rawName.toLowerCase());
      if (privilegedId) {
        const priv = await Character.findById(privilegedId);
        data.score = calcScore({ resonance: (data.resonance ?? priv?.resonance ?? 0) as number, armor: (data.armor ?? priv?.armor ?? 0) as number, armorPenetration: (data.armorPenetration ?? priv?.armorPenetration ?? 0) as number, power: (data.power ?? priv?.power ?? 0) as number, resistance: (data.resistance ?? priv?.resistance ?? 0) as number });
        await Character.findByIdAndUpdate(privilegedId, data);
        await upsertAttendanceAdmin(row, privilegedId, clan._id, swByDate);
        results.push({ name: rawName, status: 'updated' });
        continue;
      }

      let char = await Character.findOne({ name: { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' } });

      if (!char) {
        data.score = calcScore({ resonance: (data.resonance ?? 0) as number, armor: (data.armor ?? 0) as number, armorPenetration: (data.armorPenetration ?? 0) as number, power: (data.power ?? 0) as number, resistance: (data.resistance ?? 0) as number });
        char = await new Character({ name: rawName, ...data, status: 'unclaimed', clan: clan._id }).save();
        results.push({ name: rawName, status: 'created' });
      } else {
        data.score = calcScore({ resonance: (data.resonance ?? char.resonance ?? 0) as number, armor: (data.armor ?? char.armor ?? 0) as number, armorPenetration: (data.armorPenetration ?? char.armorPenetration ?? 0) as number, power: (data.power ?? char.power ?? 0) as number, resistance: (data.resistance ?? char.resistance ?? 0) as number });
        await Character.findByIdAndUpdate(char._id, { ...data, clan: clan._id });
        results.push({ name: rawName, status: 'updated' });
      }

      await upsertAttendanceAdmin(row, char._id, clan._id, swByDate);
      await openMembership(char._id, clan._id, 'member');
      newMemberIds.push(char._id as Types.ObjectId);
    }

    // Characters previously in member[] but NOT in the file get removed (exclude leader/officer)
    const privilegedIdSet = new Set(privilegedIds);
    const removedIds = (clan.member ?? []).map(String).filter(id =>
      !newMemberIds.some(nid => String(nid) === id) && !privilegedIdSet.has(id)
    );
    if (removedIds.length) {
      await Character.updateMany({ _id: { $in: removedIds } }, { $unset: { clan: '' } });
      await Promise.all(removedIds.map(id => closeMembership(id, clan._id)));
    }

    clan.member = newMemberIds;
    await clan.save();

    res.status(200).json({ processed: results.length, removed: removedIds.length, results });
  } catch (err) {
    res.status(500).json({ error: message.user.error, details: (err as Error).message });
  }
});

// ── Change member role (officer ↔ member, or promote to leader) ───────────────
router.patch('/:id/members/:memberId/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.body as { role?: string };
    if (!role || !['leader', 'officer', 'member'].includes(role)) {
      res.status(400).json({ message: 'Rol inválido. Use "leader", "officer" o "member".' }); return;
    }

    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const memberId = String(req.params.memberId);
    const leaderId = clan.leader ? String(clan.leader) : null;

    if (role === 'leader') {
      if (leaderId === memberId) { res.status(200).json({ ok: true }); return; }
      // Remove from officer/member
      clan.officer = clan.officer.filter(o => String(o) !== memberId);
      clan.member  = clan.member.filter(m => String(m) !== memberId);
      // Previous leader → member (if not already elsewhere)
      if (leaderId) {
        const inMember  = clan.member.some(m => String(m) === leaderId);
        const inOfficer = clan.officer.some(o => String(o) === leaderId);
        if (!inMember && !inOfficer) clan.member.push(clan.leader!);
      }
      clan.leader = new Types.ObjectId(memberId) as unknown as typeof clan.leader;
      await clan.save();
      await Character.findByIdAndUpdate(memberId, { clan: clan._id });
    } else if (role === 'officer') {
      if (memberId === leaderId) { res.status(400).json({ message: 'El líder no puede cambiar de rol aquí.' }); return; }
      clan.member  = clan.member.filter(m => String(m) !== memberId);
      if (!clan.officer.some(o => String(o) === memberId)) {
        clan.officer.push(new Types.ObjectId(memberId) as unknown as typeof clan.officer[number]);
      }
      await clan.save();
    } else {
      // member
      if (memberId === leaderId) { res.status(400).json({ message: 'El líder no puede cambiar de rol aquí.' }); return; }
      clan.officer = clan.officer.filter(o => String(o) !== memberId);
      if (!clan.member.some(m => String(m) === memberId)) {
        clan.member.push(new Types.ObjectId(memberId) as unknown as typeof clan.member[number]);
      }
      await clan.save();
    }
    await updateOpenRole(memberId, clan._id, role as 'leader' | 'officer' | 'member');

    res.status(200).json({ ok: true });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    // Collect all member IDs to notify
    const allCharIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...(clan.officer ?? []).map(String),
      ...(clan.member  ?? []).map(String),
    ];

    await Clan.findByIdAndDelete(req.params.id);

    // Unset clan from all characters
    if (allCharIds.length) {
      await Character.updateMany({ _id: { $in: allCharIds } }, { $unset: { clan: '' } });
      await Promise.all(allCharIds.map(id => closeMembership(id, String(req.params.id))));
    }

    // Notify connected users via socket
    try {
      const { getIO } = await import('../../socket');
      const io = getIO();
      const users = await (await import('../../models/User')).default
        .find({ character: { $in: allCharIds } }).select('_id');
      for (const u of users) {
        io.to(`user:${String(u._id)}`).emit('clan:deleted', { clanId: req.params.id });
      }
    } catch { /* socket failure never breaks response */ }

    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
