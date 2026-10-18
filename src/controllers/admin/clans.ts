import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import type { IClan } from '../../types';
import { closeMembership, rosterRoles, syncRosterChange } from '../../helpers/clanMembership';
import { parseRosterFile, RosterFormatError } from '../../helpers/rosterImport';
import { applyRosterSync } from '../../helpers/rosterSync';
import { escapeRegex } from '../../helpers/clanScope';
import { handleError } from '../../helpers/http';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
const STATUS_ORDER: Record<string, number> = { claimed: 0, pending: 1, unclaimed: 2 };

async function getClansSorted(query: Record<string, unknown> = {}, { page = 1, limit = 20 } = {}) {
  // Ordena por status en la BD (claimed → pending → unclaimed) y recién después pagina,
  // para que el orden sea global y no solo dentro de cada página.
  const statusBranches = Object.entries(STATUS_ORDER).map(([k, v]) => ({ case: { $eq: ['$status', k] }, then: v }));
  const raw = await Clan.aggregate<IClan & { _id: Types.ObjectId }>([
    { $match: query },
    { $addFields: { _statusOrder: { $switch: { branches: statusBranches, default: 3 } } } },
    { $sort: { _statusOrder: 1, name: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: { _statusOrder: 0 } },
  ]);
  const clans = await Clan.populate(raw, { path: 'leader' }) as typeof raw;
  return clans
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
    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    const pageNum  = Math.max(1, parseInt(page  ?? '1',  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10)));
    const query    = q?.trim() ? { name: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const total    = await Clan.countDocuments(query);
    const data     = await getClansSorted(query, { page: pageNum, limit: limitNum });
    res.status(200).json({ data, total, page: pageNum, limit: limitNum, hasMore: pageNum * limitNum < total });
  } catch (err) { handleError(res, err); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id)
      .populate('leader',  'name currentClass resonance status armor armorPenetration power resistance')
      .populate('officer', 'name currentClass resonance status armor armorPenetration power resistance')
      .populate('member',  'name currentClass resonance status armor armorPenetration power resistance');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    res.status(200).json(clan);
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    await new Clan({ name }).save();
    res.status(201).json(await getClansSorted());
  } catch (err) { handleError(res, err); }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { _id, name, status, leader, officer, member } = req.body as { _id?: string; name?: string; status?: string; leader?: string | null; officer?: string[]; member?: string[] };
    const prevClan = await Clan.findById(_id).select('leader officer member');
    if (!prevClan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const update: Record<string, unknown> = {};
    if (name    !== undefined) update.name    = String(name).trim();
    if (status  !== undefined) {
      if (!(status in STATUS_ORDER)) { res.status(400).json({ message: 'Estado inválido.' }); return; }
      update.status = status;
    }
    if (leader  !== undefined) update.leader  = leader || null;
    if (officer !== undefined) update.officer = (officer ?? []).map(String);
    if (member  !== undefined) update.member  = (member ?? []).map(String);
    const updatedClan = await Clan.findByIdAndUpdate(_id, update, { new: true });
    if (!updatedClan) { res.status(404).json({ message: 'Clan not found' }); return; }

    await syncRosterChange(updatedClan._id, rosterRoles(prevClan), rosterRoles(updatedClan), req.user!._id);
    res.status(201).json(await getClansSorted());
  } catch (err) { handleError(res, err); }
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

    const newLeaderChar = await Character.findById(newLeaderId).select('clan');
    if (!newLeaderChar) { res.status(404).json({ message: 'Personaje no encontrado.' }); return; }
    if (newLeaderChar.clan && String(newLeaderChar.clan) !== String(clan._id)) {
      res.status(409).json({ message: 'El personaje pertenece a otro clan.' }); return;
    }

    const before = rosterRoles(clan);
    clan.leader = new Types.ObjectId(newLeaderId) as unknown as typeof clan.leader;
    await clan.save();
    await syncRosterChange(clan._id, before, rosterRoles(clan), req.user!._id);

    res.status(200).json(await getClansSorted());
  } catch (err) { handleError(res, err); }
});

router.delete('/:id/leader', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    const before = rosterRoles(clan);
    // El exlíder sigue en el clan como miembro: así Character.clan y el historial quedan coherentes.
    if (clan.leader && !clan.member.some(m => String(m) === String(clan.leader)) && !clan.officer.some(o => String(o) === String(clan.leader))) {
      clan.member.push(clan.leader);
    }
    clan.leader = undefined;
    await clan.save();
    await syncRosterChange(clan._id, before, rosterRoles(clan), req.user!._id);
    res.status(200).json(await getClansSorted());
  } catch (err) { handleError(res, err); }
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
  } catch (err) { handleError(res, err); }
});

// ── Sync clan membership from CSV / XLSX (admin, overwrites member[]) ─────────
router.post('/:id/sync', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    let parsed;
    try { parsed = req.file ? parseRosterFile(req.file.buffer) : null; }
    catch (e) { res.status(400).json({ message: e instanceof RosterFormatError ? e.message : 'No se pudo leer el archivo.' }); return; }
    if (!parsed) { res.status(400).json({ message: 'No se recibió ningún archivo.' }); return; }
    // Dashboard: sin paso de revisión, los personajes nuevos se crean.
    res.status(200).json(await applyRosterSync(clan, parsed, {}, req.user!._id));
  } catch (err) { handleError(res, err); }
});

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
    const inClan = leaderId === memberId
      || clan.officer.some(o => String(o) === memberId)
      || clan.member.some(m => String(m) === memberId);
    if (!inClan) { res.status(404).json({ message: 'El personaje no pertenece a este clan.' }); return; }
    const before = rosterRoles(clan);

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
    await syncRosterChange(clan._id, before, rosterRoles(clan), req.user!._id);

    res.status(200).json({ ok: true });
  } catch (err) { handleError(res, err); }
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
  } catch (err) { handleError(res, err); }
});

export default router;
