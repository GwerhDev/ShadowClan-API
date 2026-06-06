import { Router, type Request, type Response } from 'express';
import AccursedTower from '../../models/AccursedTower';
import Clan          from '../../models/Clan';
import Character     from '../../models/Character';
import ClanPost      from '../../models/ClanPost';
import { message }   from '../../messages';
import type { IUser } from '../../types';
import { Types } from 'mongoose';

const router = Router();

type ClanId = Types.ObjectId | null | false;

function isAdmin(user: IUser) { return user.role === 'admin' || user.role === 'super_admin'; }

async function resolveClan(user: IUser, characterId: string | undefined): Promise<ClanId> {
  if (isAdmin(user)) {
    if (!characterId) return null;
    const char = await Character.findById(characterId).select('clan');
    return (char?.clan as Types.ObjectId | undefined) ?? null;
  }
  const charIds = user.character.map(String);
  if (!characterId || !charIds.includes(String(characterId))) return false;
  const char = await Character.findById(characterId).select('clan');
  return (char?.clan as Types.ObjectId | undefined) ?? false;
}

async function resolveClanForWrite(user: IUser, characterId: string | undefined): Promise<ClanId> {
  if (isAdmin(user)) {
    if (!characterId) return null;
    const char = await Character.findById(characterId).select('clan');
    return (char?.clan as Types.ObjectId | undefined) ?? null;
  }
  const clanId = await resolveClan(user, characterId);
  if (!clanId) return false;
  const clan = await Clan.findOne({ _id: clanId, $or: [{ leader: characterId }, { officer: characterId }] }).select('_id');
  return (clan?._id as Types.ObjectId | undefined) ?? false;
}

async function populateRosters(towers: any[]): Promise<any[]> {
  const allIds = new Set<string>();
  for (const t of towers) {
    for (const grp of ['group1', 'group2', 'group3'] as const) {
      for (const id of (t.roster?.[grp] ?? []))      if (id) allIds.add(String(id));
      for (const id of (t.finalRoster?.[grp] ?? [])) if (id) allIds.add(String(id));
    }
  }
  const chars = allIds.size
    ? await Character.find({ _id: { $in: [...allIds] } }).select('name currentClass score clan').lean()
    : [];
  const charMap = new Map(chars.map(c => [String((c as any)._id), c]));
  const mapGroup = (g: any[]) => (g ?? []).map((id: any) => id ? (charMap.get(String(id)) ?? null) : null);
  return towers.map(t => {
    const obj = t.toObject ? t.toObject() : { ...t };
    if (obj.roster)      obj.roster      = { group1: mapGroup(obj.roster.group1),      group2: mapGroup(obj.roster.group2),      group3: mapGroup(obj.roster.group3) };
    if (obj.finalRoster) obj.finalRoster = { group1: mapGroup(obj.finalRoster.group1), group2: mapGroup(obj.finalRoster.group2), group3: mapGroup(obj.finalRoster.group3) };
    return obj;
  });
}

async function pop(q: any): Promise<any> {
  const result = await (q as ReturnType<typeof AccursedTower.findById>).populate('enemyClan').lean();
  if (!result) return null;
  if (Array.isArray(result)) return populateRosters(result);
  const [populated] = await populateRosters([result]);
  return populated;
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClan(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const filter = { completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    const towers = await pop(AccursedTower.find(filter).sort({ date: 1 }) as unknown as ReturnType<typeof AccursedTower.findById>);
    res.status(200).json(towers);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClan(req.user!, (req.query.characterId as string));
    const baseFilter = { active: true, completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    const now = new Date();
    let towers = await pop(AccursedTower.find({ ...baseFilter, date: { $gte: now } }).sort({ date: 1 }) as unknown as ReturnType<typeof AccursedTower.findById>);
    if (!(towers as unknown[]).length) towers = await pop(AccursedTower.find(baseFilter).sort({ date: -1 }) as unknown as ReturnType<typeof AccursedTower.findById>);
    res.status(200).json(towers);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, towerNumber, date, enemyClan } = req.body as { characterId?: string; towerNumber?: number; date?: string; enemyClan?: string };
    const clanId = await resolveClanForWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!towerNumber) { res.status(400).json({ message: 'towerNumber requerido.' }); return; }
    if (!date)        { res.status(400).json({ message: 'date requerido.' }); return; }
    const tower = await new AccursedTower({ clan: clanId ?? null, towerNumber, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : new Date(date), enemyClan: enemyClan ?? null, roster: { group1: [], group2: [], group3: [] } }).save();
    const populated = await pop(AccursedTower.findById(tower._id));
    try {
      if (clanId) {
        const clanDoc = await Clan.findById(clanId).select('leader officer');
        const charIds = req.user!.character.map(String);
        const authorId = charIds.find(id => String(clanDoc!.leader) === id || (clanDoc!.officer ?? []).some(o => String(o) === id));
        if (authorId) await ClanPost.create({ clan: clanId, author: authorId, content: '', source: 'accursed_tower', referenceId: tower._id, auto: true });
      }
    } catch (e) { console.error('call-to-arms (accursed_tower):', e); }
    res.status(201).json(populated);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/clans', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query as { q?: string };
    if (!q?.trim()) { res.status(200).json([]); return; }
    const clans = await Clan.find({ name: { $regex: q.trim(), $options: 'i' } }).limit(10).lean();
    res.status(200).json(clans);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/clans', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, name } = req.body as { characterId?: string; name?: string };
    const clanId = await resolveClanForWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!name?.trim()) { res.status(400).json({ message: 'Nombre requerido.' }); return; }
    const existing = await Clan.findOne({ name: { $regex: `^${name.trim()}$`, $options: 'i' } });
    if (existing) { res.status(409).json({ message: 'Ya existe un clan con ese nombre.' }); return; }
    res.status(201).json(await new Clan({ name: name.trim() }).save());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const charIds = req.user!.character.map(String);
    const { characterId, action } = req.body as { characterId?: string; action?: string };
    const charId = characterId && charIds.includes(String(characterId)) ? String(characterId) : null;
    if (!charId) { res.status(400).json({ message: 'characterId requerido y debe pertenecerte.' }); return; }
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }

    const charRef = charId as unknown as typeof tower.confirmed[0];
    const act = action ?? 'confirm';
    if (act === 'confirm') {
      tower.declined  = tower.declined.filter(id => String(id) !== charId) as typeof tower.declined;
      if (!tower.confirmed.some(id => String(id) === charId)) tower.confirmed.push(charRef);
    } else if (act === 'decline') {
      tower.confirmed = tower.confirmed.filter(id => String(id) !== charId) as typeof tower.confirmed;
      if (!tower.declined.some(id => String(id) === charId)) tower.declined.push(charRef);
    } else {
      tower.confirmed = tower.confirmed.filter(id => String(id) !== charId) as typeof tower.confirmed;
      tower.declined  = tower.declined.filter(id => String(id) !== charId) as typeof tower.declined;
    }
    await tower.save();
    try {
      const { getIO } = await import('../../socket');
      const clanId = String(tower.clan ?? '');
      if (clanId) getIO().to(`clan:${clanId}`).emit('tower:updated', { towerId: String(tower._id) });
    } catch (e) { console.warn('tower:respond socket error:', (e as Error).message); }
    res.status(200).json({ confirmed: true });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tower = await pop(AccursedTower.findById(req.params.id));
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClan(req.user!, (req.query.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String((tower as unknown as { clan?: unknown }).clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    res.status(200).json(tower);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClanForWrite(req.user!, (req.body.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(tower.clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }

    const oldAssigned = new Set<string>();
    for (const g of ['group1', 'group2', 'group3'] as const) {
      for (const id of (tower.roster?.[g] ?? [])) if (id) oldAssigned.add(String(id));
    }

    const { towerNumber, date, roster, enemyClan, completed, result, finalRoster } = req.body as Record<string, unknown>;
    if (towerNumber !== undefined) tower.towerNumber = towerNumber as number;
    if (date !== undefined) tower.date = /^\d{4}-\d{2}-\d{2}$/.test(date as string) ? new Date((date as string) + 'T12:00:00Z') : new Date(date as string);
    if (enemyClan !== undefined) tower.enemyClan = (enemyClan as string | undefined) ? (enemyClan as unknown as import("../../types").IShadowWar["enemyClan"]) : undefined;
    if (roster)                  tower.roster      = roster as typeof tower.roster;
    if (finalRoster !== undefined) (tower as any).finalRoster = finalRoster;
    if (completed !== undefined) tower.completed = completed as boolean;
    if (result !== undefined)    tower.result    = result as typeof tower.result;
    await tower.save();
    const updatedTower = await pop(AccursedTower.findById(tower._id));

    const towerClanId = String(tower.clan ?? '');
    try {
      const { getIO } = await import('../../socket');
      const io = getIO();
      if (towerClanId) io.to(`clan:${towerClanId}`).except(`user:${String(req.user!._id)}`).emit('tower:updated', { towerId: String(tower._id) });

      if (roster) {
        const newlyAssigned: Array<{ _id: unknown; name?: string }> = [];
        for (const g of ['group1', 'group2', 'group3'] as const) {
          for (const char of ((updatedTower as any)?.roster?.[g] ?? [])) {
            if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char);
          }
        }
        if (newlyAssigned.length) {
          const User = (await import('../../models/User')).default;
          for (const char of newlyAssigned) {
            const owner = await User.findOne({ character: char._id });
            if (owner) io.to(`user:${String(owner._id)}`).emit('tower:assigned', {
              id: `tower:${String(tower._id)}:${String(char._id)}`,
              towerId: String(tower._id),
              characterId: String(char._id),
              characterName: (char as any).name,
              towerNumber: (updatedTower as any)?.towerNumber,
              date: (updatedTower as any)?.date,
            });
          }
        }
      }
    } catch (e) { console.warn('tower socket error:', (e as Error).message); }

    res.status(200).json(updatedTower);
  } catch (err) { res.status(500).json({ error: message.user.error, details: (err as Error).message }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClanForWrite(req.user!, (req.query.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(tower.clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    await AccursedTower.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Torre eliminada.' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
