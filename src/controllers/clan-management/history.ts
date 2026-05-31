import { Router, type Request, type Response } from 'express';
import ShadowWar     from '../../models/ShadowWar';
import AccursedTower from '../../models/AccursedTower';
import Character     from '../../models/Character';
import Clan          from '../../models/Clan';
import { message }   from '../../messages';
import type { IUser } from '../../types';

const router = Router();

function isAdmin(user: IUser) { return user.role === 'admin' || user.role === 'super_admin'; }

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const skip  = (page - 1) * limit;
    const type  = (req.query.type as string) || 'all';
    const q     = (req.query.q as string)?.trim();

    let clanFilter: Record<string, unknown> = {};
    const { characterId } = req.query as { characterId?: string };
    if (characterId) {
      // Always scope to character's clan when characterId is provided, even for admins
      const char = await Character.findById(characterId).select('clan');
      if (!char?.clan) { res.status(200).json({ total: 0, page, limit, pages: 0, data: [] }); return; }
      clanFilter = { clan: char.clan };
    } else if (!isAdmin(req.user!)) {
      // Non-admins without characterId → empty
      res.status(200).json({ total: 0, page, limit, pages: 0, data: [] }); return;
    }
    // Admins without characterId → see all (dashboard use case)

    // Search by enemy clan name
    if (q) {
      const matchingClans = await Clan.find({ name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).select('_id').lean();
      const ids = matchingClans.map(c => c._id);
      clanFilter = { ...clanFilter, enemyClan: { $in: ids } };
    }

    if (type === 'shadow_war') {
      const total = await ShadowWar.countDocuments(clanFilter);
      const data  = await ShadowWar.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'shadow_war' })) });
      return;
    }

    if (type === 'accursed_tower') {
      const total = await AccursedTower.countDocuments(clanFilter);
      const data  = await AccursedTower.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'accursed_tower' })) });
      return;
    }

    const [swAll, atAll] = await Promise.all([
      ShadowWar.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
      AccursedTower.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
    ]);
    const combined = [
      ...swAll.map(d => ({ ...d.toObject(), type: 'shadow_war' as const })),
      ...atAll.map(d => ({ ...d.toObject(), type: 'accursed_tower' as const })),
    ].sort((a, b) => new Date(b.date as Date).getTime() - new Date(a.date as Date).getTime());

    res.status(200).json({ total: combined.length, page, limit, pages: Math.ceil(combined.length / limit), data: combined.slice(skip, skip + limit) });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, type, date, enemyClanName, result, towerNumber } =
      req.body as { characterId?: string; type?: string; date?: string; enemyClanName?: string; result?: string; towerNumber?: number };

    if (!type || !['shadow_war', 'accursed_tower'].includes(type)) {
      res.status(400).json({ message: 'Tipo inválido. Use shadow_war o accursed_tower' }); return;
    }

    // Resolve character's clan and verify leader/officer
    const user     = req.user!;
    const charIds  = user.character.map(String);
    const isAdminUser = isAdmin(user);

    let clanId: unknown;
    if (isAdminUser && !characterId) {
      res.status(400).json({ message: 'Se requiere characterId' }); return;
    }
    if (characterId && !charIds.includes(String(characterId)) && !isAdminUser) {
      res.status(403).json({ message: 'No autorizado' }); return;
    }
    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.status(400).json({ message: 'El personaje no tiene clan' }); return; }
    clanId = char.clan;

    if (!isAdminUser) {
      const clan = await Clan.findById(clanId).select('leader officer');
      if (!clan) { res.status(404).json({ message: 'Clan no encontrado' }); return; }
      const isLeader  = String(clan.leader) === String(characterId);
      const isOfficer = (clan.officer ?? []).some((o: unknown) => String(o) === String(characterId));
      if (!isLeader && !isOfficer) { res.status(403).json({ message: 'Solo líderes y oficiales pueden agregar historial' }); return; }
    }

    // Find or create enemy clan
    let enemyClanId: unknown = null;
    if (enemyClanName?.trim()) {
      const name    = enemyClanName.trim();
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let enemy = await Clan.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } });
      if (!enemy) enemy = await new Clan({ name }).save();
      enemyClanId = enemy._id;
    }

    const parsedDate = date ? new Date(date) : new Date();
    const validResult = ['victory', 'defeat', 'draw'].includes(result ?? '') ? result : 'pending';

    if (type === 'shadow_war') {
      const empty = () => Array(3).fill(null).map(() => ({ group1: { character: [] }, group2: { character: [] }, result: 'pending' }));
      const sw = await new ShadowWar({
        clan: clanId, date: parsedDate, enemyClan: enemyClanId,
        result: validResult, completed: true, confirmed: [],
        battle: { exalted: empty(), eminent: empty(), famed: empty(), proud: empty() },
      }).save();
      const populated = await ShadowWar.findById(sw._id).populate('enemyClan');
      res.status(201).json({ ...populated!.toObject(), type: 'shadow_war' }); return;
    }

    const tower = await new AccursedTower({
      clan: clanId, date: parsedDate, enemyClan: enemyClanId,
      towerNumber: towerNumber ?? 1, result: validResult,
      completed: true, roster: { group1: [], group2: [], group3: [] },
    }).save();
    const populated = await AccursedTower.findById(tower._id).populate('enemyClan');
    res.status(201).json({ ...populated!.toObject(), type: 'accursed_tower' });
  } catch (err) {
    res.status(500).json({ error: message.user.error, details: (err as Error).message });
  }
});

export default router;
