import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { Types } from 'mongoose';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import { message } from '../../messages';

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

const router = Router();
const STATUS_ORDER: Record<string, number> = { claimed: 0, pending: 1, unclaimed: 2 };

async function getClansSorted(query: Record<string, unknown> = {}, { page = 1, limit = 50 } = {}) {
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
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};
    res.status(200).json(await getClansSorted(query, { page: parseInt(page ?? '1', 10), limit: parseInt(limit ?? '50', 10) }));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id)
      .populate('leader',  'name currentClass resonance status')
      .populate('officer', 'name currentClass resonance status')
      .populate('member',  'name currentClass resonance status');
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
        await Character.findByIdAndUpdate(privilegedId, data);
        results.push({ name: rawName, status: 'updated' });
        continue;
      }

      let char = await Character.findOne({ name: { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' } });

      if (!char) {
        char = await new Character({ name: rawName, ...data, status: 'unclaimed', clan: clan._id }).save();
        results.push({ name: rawName, status: 'created' });
      } else {
        await Character.findByIdAndUpdate(char._id, { ...data, clan: clan._id });
        results.push({ name: rawName, status: 'updated' });
      }

      newMemberIds.push(char._id as Types.ObjectId);
    }

    // Characters previously in member[] but NOT in the file get removed (exclude leader/officer)
    const privilegedIdSet = new Set(privilegedIds);
    const removedIds = (clan.member ?? []).map(String).filter(id =>
      !newMemberIds.some(nid => String(nid) === id) && !privilegedIdSet.has(id)
    );
    if (removedIds.length) {
      await Character.updateMany({ _id: { $in: removedIds } }, { $unset: { clan: '' } });
    }

    clan.member = newMemberIds;
    await clan.save();

    res.status(200).json({ processed: results.length, removed: removedIds.length, results });
  } catch (err) {
    res.status(500).json({ error: message.user.error, details: (err as Error).message });
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Clan.findByIdAndDelete(req.params.id);
    if (!deleted) { res.status(404).json({ message: 'Clan not found' }); return; }
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
