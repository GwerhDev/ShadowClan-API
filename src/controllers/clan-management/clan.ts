import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { Types } from 'mongoose';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import User from '../../models/User';
import ClanInvitation from '../../models/ClanInvitation';
import { message } from '../../messages';
import type { IUser, IClan } from '../../types';
import { calcScore } from '../../helpers/score';
import ShadowWar from '../../models/ShadowWar';
import Attendance from '../../models/Attendance';
import { openMembership, closeMembership, updateOpenRole } from '../../helpers/clanMembership';
import ClanMembership from '../../models/ClanMembership';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Spanish class name → system value
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
const VALID_VALUES = new Set(Object.values(CLASS_MAP));

function resolveClass(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const key = String(raw).trim().toLowerCase();
  return CLASS_MAP[key] ?? (VALID_VALUES.has(key) ? key : undefined);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return isNaN(n) || v === '' || v === null || v === undefined ? undefined : n;
}

// ── Attendance import helpers ─────────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12
};
const NON_DATE_COLS = new Set(['Rank','Jugador','Armadura','Penetracion','Potencia','Resistencia','Resonancia','Score','Clase','Whatsapp','Observaciones','Asist']);

function parseDateCol(col: string, year: number): string | null {
  const m = col.match(/^(\d{1,2})([a-z]+)$/i);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[1], 10);
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

async function buildSwByDate(rows: Record<string, unknown>[], clanId: unknown): Promise<Map<string, any>> {
  const year    = new Date().getFullYear();
  const allCols = rows.length ? Object.keys(rows[0]) : [];
  const dateCols = allCols.filter(c => !NON_DATE_COLS.has(c) && parseDateCol(c, year) !== null);
  const map     = new Map<string, any>();
  for (const col of dateCols) {
    const dateStr = parseDateCol(col, year)!;
    const start   = new Date(dateStr + 'T00:00:00.000Z');
    const end     = new Date(dateStr + 'T23:59:59.999Z');
    const sw      = await ShadowWar.findOne({ clan: clanId, date: { $gte: start, $lte: end } }).select('_id date clan');
    map.set(col, sw ?? null);
  }
  return map;
}

async function upsertAttendance(
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

const populateClan = (q: ReturnType<typeof Clan.findById>) =>
  q.populate('leader').populate('officer').populate('member');

function isSystemAdmin(user: IUser) { return user.role === 'admin' || user.role === 'super_admin'; }
function userCharIds(user: IUser)   { return user.character.map(String); }
function charIsLeader(clan: IClan, user: IUser)          { return isSystemAdmin(user) || userCharIds(user).includes(String(clan.leader)); }
function charIsOfficerOrLeader(clan: IClan, user: IUser) {
  return isSystemAdmin(user) || userCharIds(user).includes(String(clan.leader)) || clan.officer.some(o => userCharIds(user).includes(String(o)));
}

router.get('/:clanId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await populateClan(Clan.findById(req.params.clanId));
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    const pendingInvitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 });
    res.status(200).json({ ...(clan as unknown as { toObject(): Record<string, unknown> }).toObject(), pendingInvitations });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.body as { characterId?: string };
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Character not found' }); return; }
    const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(characterId));
    if (!alreadyIn) { clan.member.push(char._id); char.clan = clan._id; await Promise.all([clan.save(), char.save()]); }
    await openMembership(char._id, clan._id, 'member');
    res.status(200).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

// Self-leave clan
router.post('/:clanId/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId);
    const { characterId } = req.body as { characterId?: string };
    if (!characterId) { res.status(400).json({ message: 'Se requiere characterId' }); return; }

    const charIds = req.user!.character.map(String);
    if (!charIds.includes(characterId)) { res.status(403).json({ message: 'No autorizado' }); return; }

    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    const isLeader = String(clan.leader) === characterId;
    const totalMembers = (clan.leader ? 1 : 0) + clan.officer.length + clan.member.length;

    if (isLeader) {
      // Only member → leave and set clan unclaimed
      if (totalMembers === 1) {
        clan.leader = undefined;
        clan.status = 'unclaimed' as typeof clan.status;
        await clan.save();
        await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
        await closeMembership(characterId, clanId);
        res.status(200).json({ message: 'Has abandonado el clan. El clan queda sin reclamar.' }); return;
      }
      res.status(400).json({ message: 'El líder no puede abandonar el clan mientras haya otros miembros. Transfiere el liderazgo primero.' }); return;
    }

    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
    await closeMembership(characterId, clanId);

    res.status(200).json({ message: 'Has abandonado el clan.' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { reason } = req.body as { reason?: string };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede eliminar al líder del clan' }); return; }
    const targetIsOfficer = clan.officer.some(o => String(o) === characterId);
    if (targetIsOfficer && !charIsLeader(clan, req.user!)) { res.status(403).json({ message: 'Solo el líder puede eliminar oficiales' }); return; }
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
    await closeMembership(characterId, clanId, {
      expulsionReason: reason?.trim() || undefined,
      removedBy: req.user!._id,
      role: targetIsOfficer ? 'officer' : 'member',
    });
    try {
      const { getIO } = await import('../../socket');
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) getIO().to(`user:${String(owner._id)}`).emit('clan:member-removed', { clanName: clan.name, characterId });
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/characters', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, resonance, currentClass } = req.body as { name?: string; resonance?: number; currentClass?: string };
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await new Character({ name, resonance, currentClass, clan: req.params.clanId, status: 'unclaimed' }).save();
    clan.member.push(char._id); await clan.save();
    await openMembership(char._id, clan._id, 'member');
    res.status(201).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { currentClass, resonance, memberStatus, armor, armorPenetration, power, resistance } =
      req.body as { currentClass?: string; resonance?: number; memberStatus?: string; armor?: number; armorPenetration?: number; power?: number; resistance?: number };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inClan = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(characterId);
    if (!inClan) { res.status(400).json({ message: 'El personaje no pertenece a este clan' }); return; }
    const existing = await Character.findById(characterId);
    const update: Record<string, unknown> = {};
    if (currentClass     !== undefined) update.currentClass     = currentClass || null;
    if (resonance        !== undefined) update.resonance        = Number(resonance);
    if (memberStatus     !== undefined) update.memberStatus     = memberStatus;
    if (armor            !== undefined) update.armor            = Number(armor);
    if (armorPenetration !== undefined) update.armorPenetration = Number(armorPenetration);
    if (power            !== undefined) update.power            = Number(power);
    if (resistance       !== undefined) update.resistance       = Number(resistance);
    update.score = calcScore({
      resonance:        resonance        !== undefined ? Number(resonance)        : (existing?.resonance        ?? 0),
      armor:            armor            !== undefined ? Number(armor)            : (existing?.armor            ?? 0),
      armorPenetration: armorPenetration !== undefined ? Number(armorPenetration) : (existing?.armorPenetration ?? 0),
      power:            power            !== undefined ? Number(power)            : (existing?.power            ?? 0),
      resistance:       resistance       !== undefined ? Number(resistance)       : (existing?.resistance       ?? 0),
    });
    await Character.findByIdAndUpdate(characterId, update);
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:clanId/members/:characterId/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { role } = req.body as { role?: string };
    if (!role || !['officer', 'member'].includes(role)) { res.status(400).json({ message: 'Rol inválido. Use "officer" o "member"' }); return; }
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsLeader(clan, req.user!)) { res.status(403).json({ message: 'Solo el líder del clan puede cambiar roles' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede cambiar el rol del líder' }); return; }
    const inClan = clan.officer.map(String).includes(characterId) || clan.member.map(String).includes(characterId);
    if (!inClan) { res.status(404).json({ message: 'El personaje no pertenece a este clan' }); return; }
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    if (role === 'officer') clan.officer.push(characterId as unknown as typeof clan.officer[0]);
    else                    clan.member.push(characterId as unknown as typeof clan.member[0]);
    await clan.save();
    await updateOpenRole(characterId, clanId, role as 'officer' | 'member');
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const invitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 });
    res.status(200).json(invitations);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clanId } = req.params;
    const { characterId, role, proposedClass, proposedResonance } = req.body as { characterId?: string; role?: string; proposedClass?: string; proposedResonance?: number };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Personaje no encontrado' }); return; }
    if (char.status !== 'claimed') { res.status(400).json({ message: 'El personaje no está vinculado a un usuario' }); return; }
    const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(characterId));
    if (alreadyIn) { res.status(409).json({ message: 'El personaje ya pertenece al clan' }); return; }
    const existing = await ClanInvitation.findOne({ clan: clanId, character: characterId, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya existe una invitación pendiente para este personaje' }); return; }
    const invitation = await ClanInvitation.create({
      clan: clanId, character: characterId, invitedByUser: req.user!._id,
      role: ['officer', 'member'].includes(role ?? '') ? role : 'member',
      proposedClass: proposedClass ?? null,
      proposedResonance: proposedResonance != null ? Number(proposedResonance) : null,
    });
    try {
      const { getIO } = await import('../../socket');
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) {
        const pop = await ClanInvitation.findById(invitation._id).populate('clan', 'name').populate('character', 'name');
        getIO().to(`user:${String(owner._id)}`).emit('clan-invitation:new', {
          id: String(pop!._id), clan: pop!.clan, character: pop!.character, role: pop!.role,
          proposedClass: pop!.proposedClass, proposedResonance: pop!.proposedResonance, createdAt: pop!.createdAt,
        });
      }
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    res.status(201).json({ message: 'Invitación enviada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:clanId/invitations/:invitationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inv = await ClanInvitation.findOneAndDelete({ _id: req.params.invitationId, clan: req.params.clanId, status: 'pending' });
    if (!inv) { res.status(404).json({ message: 'Invitación no encontrada' }); return; }
    res.status(200).json({ message: 'Invitación cancelada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Paginated members list ────────────────────────────────────────────────────
// status: 'active' (solo miembros actuales) | 'ex' (solo exmiembros) | 'all' (default,
// activos primero y exmiembros al final). Los datos de exmiembros (motivo, quién lo
// sacó) solo se incluyen si quien pregunta es líder/oficial — si no, 'all' degrada a
// solo activos en silencio (no rompe la vista para un miembro común) y 'ex' devuelve 403.
router.get('/:clanId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const { q, page: rawPage, limit: rawLimit, status: rawStatus } = req.query as Record<string, string>;
    const page   = Math.max(1, parseInt(rawPage  ?? '1',  10));
    const limit  = Math.min(50, Math.max(1, parseInt(rawLimit ?? '20', 10)));
    const status = (['active', 'ex', 'all'].includes(rawStatus) ? rawStatus : 'all') as 'active' | 'ex' | 'all';

    const canSeeExMembers = charIsOfficerOrLeader(clan, req.user!);
    if (status === 'ex' && !canSeeExMembers) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const wantsEx = status === 'ex' || (status === 'all' && canSeeExMembers);

    let activeRows: Array<Record<string, unknown>> = [];
    if (status !== 'ex') {
      // Build ordered role map: leader → officer → member
      const roleOrder: Record<string, number> = {};
      const roleLabel: Record<string, 'leader' | 'officer' | 'member'> = {};
      if (clan.leader) { const k = String(clan.leader); roleOrder[k] = 0; roleLabel[k] = 'leader'; }
      for (const o of clan.officer ?? []) { const k = String(o); roleOrder[k] = 1; roleLabel[k] = 'officer'; }
      for (const m of clan.member  ?? []) { const k = String(m); roleOrder[k] = 2; roleLabel[k] = 'member'; }
      const allIds = Object.keys(roleLabel);

      const filter: Record<string, unknown> = { _id: { $in: allIds } };
      if (q?.trim()) filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };

      const chars = await Character.find(filter).select('name currentClass resonance memberStatus status armor armorPenetration power resistance score').lean();
      chars.sort((a, b) => {
        const ra = roleOrder[String(a._id)] ?? 2;
        const rb = roleOrder[String(b._id)] ?? 2;
        return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
      });
      activeRows = chars.map(c => ({ ...c, role: roleLabel[String(c._id)] ?? 'member', isExMember: false }));
    }

    let exRows: Array<Record<string, unknown>> = [];
    if (wantsEx) {
      const exDocs = await ClanMembership.find({ clan: clan._id, leftAt: { $ne: null } })
        .sort({ leftAt: -1 })
        .populate('character', 'name currentClass resonance memberStatus status armor armorPenetration power resistance score')
        .lean();
      const qLower = q?.trim().toLowerCase();
      exRows = exDocs
        .filter(d => d.character && (!qLower || (d.character as unknown as { name?: string }).name?.toLowerCase().includes(qLower)))
        .map(d => ({
          ...(d.character as object),
          role: d.role,
          isExMember: true,
          leftAt: d.leftAt,
          expulsionReason: d.expulsionReason,
        }));
    }

    const combined = status === 'ex' ? exRows : status === 'active' ? activeRows : [...activeRows, ...exRows];
    const total  = combined.length;
    const sliced = combined.slice((page - 1) * limit, page * limit);

    res.status(200).json({ total, page, limit, hasMore: page * limit < total, members: sliced });
  } catch { res.status(500).json({ error: message.user.error }); }
});

// ── Bulk import from CSV / XLSX ───────────────────────────────────────────────
router.post('/:clanId/bulk-import', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ message: 'No se recibió ningún archivo.' }); return; }

    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }

    // Parse file (supports .csv and .xlsx)
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    type ImportResult = { name: string; status: 'created' | 'updated' | 'invited' | 'skipped'; reason?: string };
    const results: ImportResult[] = [];
    const swByDate = await buildSwByDate(rows, clan._id);

    for (const row of rows) {
      const rawName = String(row['Jugador'] ?? '').trim();
      if (!rawName) continue;

      const data = {
        resonance:        num(row['Resonancia']),
        armor:            num(row['Armadura']),
        armorPenetration: num(row['Penetracion']),
        power:            num(row['Potencia']),
        resistance:       num(row['Resistencia']),
        currentClass:     resolveClass(row['Clase']),
        whatsapp:         row['Whatsapp'] ? String(row['Whatsapp']).trim() : undefined,
      };

      // Remove undefined keys so we don't wipe existing values with undefined
      const update: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) { if (v !== undefined) update[k] = v; }

      // Find existing character by name (case-insensitive)
      const existing = await Character.findOne({ name: { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' } });

      if (!existing) {
        // Create new unclaimed character and add to clan
        update.score = calcScore({ resonance: (update.resonance ?? 0) as number, armor: (update.armor ?? 0) as number, armorPenetration: (update.armorPenetration ?? 0) as number, power: (update.power ?? 0) as number, resistance: (update.resistance ?? 0) as number });
        const char = await new Character({ name: rawName, ...update, status: 'unclaimed' }).save();
        clan.member.push(char._id as Types.ObjectId);
        await clan.save();
        await openMembership(char._id, clan._id, 'member');
        await upsertAttendance(row, char._id, clan._id, swByDate);
        results.push({ name: rawName, status: 'created' });
        continue;
      }

      const existingClanStr  = existing.clan ? String(existing.clan) : null;
      const targetClanStr    = String(clan._id);
      const inThisClan       = existingClanStr === targetClanStr;
      const inAnotherClan    = existingClanStr !== null && !inThisClan;

      if (inAnotherClan) {
        // Character belongs to a different clan → send invitation instead of forcing move
        const alreadyInvited = await ClanInvitation.findOne({ clan: clan._id, character: existing._id, status: 'pending' });
        if (!alreadyInvited) {
          await ClanInvitation.create({
            clan:              clan._id,
            character:         existing._id,
            invitedByUser:     req.user!._id,
            role:              'member',
            proposedClass:     data.currentClass ?? null,
            proposedResonance: data.resonance ?? null,
          });
          // Notify character owner
          try {
            const { getIO } = await import('../../socket');
            const owner = await User.findOne({ character: existing._id }).select('_id');
            if (owner) {
              const pop = await ClanInvitation.findOne({ clan: clan._id, character: existing._id, status: 'pending' })
                .populate('clan', 'name').populate('character', 'name');
              if (pop) getIO().to(`user:${String(owner._id)}`).emit('clan-invitation:new', {
                id: String(pop._id), clan: pop.clan, character: pop.character,
                role: pop.role, proposedClass: pop.proposedClass, proposedResonance: pop.proposedResonance,
                createdAt: pop.createdAt,
              });
            }
          } catch { /* socket failure never breaks the response */ }
        }
        results.push({ name: rawName, status: 'invited', reason: 'Pertenece a otro clan. Se envió invitación.' });
        continue;
      }

      // Character is unclaimed or in this clan → update stats
      update.score = calcScore({ resonance: (update.resonance ?? existing.resonance ?? 0) as number, armor: (update.armor ?? existing.armor ?? 0) as number, armorPenetration: (update.armorPenetration ?? existing.armorPenetration ?? 0) as number, power: (update.power ?? existing.power ?? 0) as number, resistance: (update.resistance ?? existing.resistance ?? 0) as number });
      await Character.findByIdAndUpdate(existing._id, update);
      await upsertAttendance(row, existing._id, clan._id, swByDate);

      // Add to clan if not already a member
      if (!inThisClan) {
        const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(existing._id));
        if (!alreadyIn) { clan.member.push(existing._id as Types.ObjectId); await clan.save(); }
      }
      await openMembership(existing._id, clan._id, 'member');

      // Notify owner if claimed
      if (existing.status === 'claimed') {
        try {
          const { getIO } = await import('../../socket');
          const owner = await User.findOne({ character: existing._id }).select('_id');
          if (owner) getIO().to(`user:${String(owner._id)}`).emit('character:stats-updated', {
            characterId: String(existing._id),
            characterName: existing.name,
            updates: update,
          });
        } catch { /* socket failure never breaks the response */ }
      }

      results.push({ name: rawName, status: 'updated' });
    }

    res.status(200).json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: message.user.error, details: (err as Error).message });
  }
});

// ── Sync (overwrite) clan members from CSV / XLSX ────────────────────────────
router.post('/:clanId/sync', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ message: 'No se recibió ningún archivo.' }); return; }

    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    // Preload leader + officer characters by ID so we can match them by name reliably
    const privilegedIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...(clan.officer ?? []).map(String),
    ];
    const privilegedChars = privilegedIds.length
      ? await Character.find({ _id: { $in: privilegedIds } }).select('_id name')
      : [];
    // lowercase name → character ID (authoritative lookup)
    const privilegedByName = new Map(
      privilegedChars.map(c => [c.name.trim().toLowerCase(), String(c._id)])
    );

    type SyncResult = { name: string; status: 'created' | 'updated' };
    const results: SyncResult[]          = [];
    const newMemberIds: Types.ObjectId[] = [];
    const swByDate = await buildSwByDate(rows, clan._id);

    for (const row of rows) {
      const rawName = String(row['Jugador'] ?? '').trim();
      if (!rawName) continue;

      const data: Record<string, unknown> = {};
      const rv  = num(row['Resonancia']);   if (rv  !== undefined) data.resonance        = rv;
      const arm = num(row['Armadura']);     if (arm !== undefined) data.armor             = arm;
      const pen = num(row['Penetracion']); if (pen !== undefined) data.armorPenetration  = pen;
      const pow = num(row['Potencia']);     if (pow !== undefined) data.power             = pow;
      const res = num(row['Resistencia']); if (res !== undefined) data.resistance        = res;
      const cls = resolveClass(row['Clase']); if (cls !== undefined) data.currentClass   = cls;
      const wa  = row['Whatsapp'];         if (wa && String(wa).trim()) data.whatsapp    = String(wa).trim();

      // Check if this row is a privileged character (leader/officer) by name
      const privilegedId = privilegedByName.get(rawName.toLowerCase());
      if (privilegedId) {
        // Update their stats but keep their role — never add to member[]
        const priv = await Character.findById(privilegedId);
        data.score = calcScore({ resonance: (data.resonance ?? priv?.resonance ?? 0) as number, armor: (data.armor ?? priv?.armor ?? 0) as number, armorPenetration: (data.armorPenetration ?? priv?.armorPenetration ?? 0) as number, power: (data.power ?? priv?.power ?? 0) as number, resistance: (data.resistance ?? priv?.resistance ?? 0) as number });
        await Character.findByIdAndUpdate(privilegedId, data);
        await upsertAttendance(row, privilegedId, clan._id, swByDate);
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

      await upsertAttendance(row, char._id, clan._id, swByDate);
      await openMembership(char._id, clan._id, 'member');
      newMemberIds.push(char._id as Types.ObjectId);
    }

    // Remove clan ref from characters that are no longer in the file (exclude leader/officer)
    const privilegedIdSet = new Set(privilegedIds);
    const removedIds = (clan.member ?? []).map(String).filter(id =>
      !newMemberIds.some(n => String(n) === id) && !privilegedIdSet.has(id)
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

router.patch('/:clanId/saved-roster', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }

    const { type, slot, data, name, customIndex, action } =
      req.body as { type?: string; slot?: string; data?: any; name?: string; customIndex?: number | null; action?: string };

    const field = type === 'accursed-tower' ? 'savedAccursedTowerAlignments'
                : type === 'shadow-war'     ? 'savedShadowWarAlignments'
                : null;
    if (!field) { res.status(400).json({ message: 'Tipo inválido.' }); return; }

    const current: { last?: any; custom?: any[] } = (clan as any)[field] ?? { last: null, custom: [] };
    if (!current.custom) current.custom = [];

    if (slot === 'last') {
      current.last = data ?? null;
    } else if (slot === 'custom') {
      if (action === 'delete') {
        if (typeof customIndex === 'number' && customIndex >= 0 && customIndex < current.custom.length) {
          current.custom.splice(customIndex, 1);
        }
      } else {
        if (current.custom.length >= 3 && (customIndex == null)) {
          res.status(400).json({ message: 'Máximo 3 plantillas. Indica cuál reemplazar.' }); return;
        }
        const entry = { name: String(name ?? '').trim(), data, savedAt: new Date() };
        if (typeof customIndex === 'number' && customIndex >= 0) current.custom[customIndex] = entry;
        else current.custom.push(entry);
      }
    } else {
      res.status(400).json({ message: 'Slot inválido. Use "last" o "custom".' }); return;
    }

    await Clan.findByIdAndUpdate(req.params.clanId, { [field]: current });
    res.status(200).json({ message: 'Alineación guardada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/auto-assign', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) {
      res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return;
    }

    const { type, formation } = req.body as { type?: string; formation?: any };
    if (type !== 'accursed-tower' && type !== 'shadow-war') {
      res.status(400).json({ message: 'Tipo inválido. Use "accursed-tower" o "shadow-war"' }); return;
    }

    const allIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...clan.officer.map(String),
      ...clan.member.map(String),
    ];
    const members = await Character.find({
      _id: { $in: allIds },
      memberStatus: { $nin: ['inactivo', 'retirado'] },
    }).select('_id currentClass score').lean();

    const { autoAssignAT, autoAssignSW } = await import('../../helpers/autoAssign');
    const result = type === 'accursed-tower'
      ? autoAssignAT(members)
      : autoAssignSW(members, formation ?? undefined);
    res.status(200).json(result);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
