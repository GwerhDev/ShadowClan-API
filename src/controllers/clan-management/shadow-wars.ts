import { Router, type Request, type Response } from 'express';
import ShadowWar from '../../models/ShadowWar';
import Clan      from '../../models/Clan';
import Character from '../../models/Character';
import ClanPost  from '../../models/ClanPost';
import { message } from '../../messages';
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

const CATS = ['exalted', 'eminent', 'famed', 'proud'] as const;

async function populateSWBattle(sws: any[]): Promise<any[]> {
  const allIds = new Set<string>();
  for (const sw of sws) {
    for (const battle of ['battle', 'finalBattle'] as const) {
      for (const cat of CATS) {
        for (const match of (sw[battle]?.[cat] ?? [])) {
          for (const id of (match.group1?.character ?? [])) if (id) allIds.add(String((id as any)?._id ?? id));
          for (const id of (match.group2?.character ?? [])) if (id) allIds.add(String((id as any)?._id ?? id));
        }
      }
    }
  }
  const chars = allIds.size
    ? await Character.find({ _id: { $in: [...allIds] } }).select('name currentClass score clan').lean()
    : [];
  const charMap = new Map(chars.map(c => [String((c as any)._id), c]));
  const toId = (v: any): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return String(v._id ?? v);
    return String(v);
  };
  const mapGroup = (g: any[]) => (g ?? []).map((id: any) => { const s = toId(id); return s ? (charMap.get(s) ?? null) : null; });
  return sws.map(sw => {
    const obj = sw.toObject ? sw.toObject() : { ...sw };
    for (const battle of ['battle', 'finalBattle'] as const) {
      if (!obj[battle]) continue;
      for (const cat of CATS) {
        if (!obj[battle][cat]) continue;
        obj[battle][cat] = (obj[battle][cat] as any[]).map((match: any) => ({
          ...match,
          group1: { ...match.group1, character: mapGroup(match.group1?.character) },
          group2: { ...match.group2, character: mapGroup(match.group2?.character) },
        }));
      }
    }
    return obj;
  });
}

async function pop(q: ReturnType<typeof ShadowWar.findById>): Promise<any> {
  const result = await q.populate('enemyClan').populate('confirmed').populate('declined').lean();
  if (!result) return null;
  if (Array.isArray(result)) return populateSWBattle(result);
  const [populated] = await populateSWBattle([result]);
  return populated;
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClan(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const filter = clanId ? { clan: clanId } : {};
    const total  = await ShadowWar.countDocuments(filter);
    const data   = await ShadowWar.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).populate('enemyClan');
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/by-date', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClan(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const d = new Date(req.query.date as string);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const filter = clanId ? { clan: clanId, date: { $gte: start, $lt: end } } : { date: { $gte: start, $lt: end } };
    const sw = await pop(ShadowWar.findOne(filter) as ReturnType<typeof ShadowWar.findById>);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    res.status(200).json(sw);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await pop(ShadowWar.findById(req.params.id));
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClan(req.user!, (req.query.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String((sw as unknown as {clan?: unknown}).clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    res.status(200).json(sw);
  } catch (err) { console.error('GET /shadow-wars/:id error:', err); res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, date, enemyClan } = req.body as { characterId?: string; date?: string; enemyClan?: string };
    const clanId = await resolveClanForWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!date) { res.status(400).json({ message: 'date requerido.' }); return; }
    const emptyMatches = () => Array(3).fill(null).map(() => ({ group1: { character: [] }, group2: { character: [] }, result: 'pending' }));
    const newSW = await new ShadowWar({ clan: clanId ?? null, date: new Date(date + 'T12:00:00Z'), enemyClan: enemyClan ?? null, confirmed: [], result: 'pending', battle: { exalted: emptyMatches(), eminent: emptyMatches(), famed: emptyMatches(), proud: emptyMatches() } }).save();
    const populated = await pop(ShadowWar.findById(newSW._id));
    try {
      if (clanId) {
        const clanDoc = await Clan.findById(clanId).select('leader officer');
        const charIds = req.user!.character.map(String);
        const authorId = charIds.find(id => String(clanDoc!.leader) === id || (clanDoc!.officer ?? []).some(o => String(o) === id));
        if (authorId) await ClanPost.create({ clan: clanId, author: authorId, content: '', source: 'shadow_war', referenceId: newSW._id, auto: true });
      }
    } catch (e) { console.error('call-to-arms (shadow_war):', e); }
    res.status(201).json(populated);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, ...safeBody } = req.body as Record<string, unknown> & { characterId?: string };
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClanForWrite(req.user!, characterId);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(sw.clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    const oldAssigned = new Set<string>();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud'] as const) {
      for (const match of (sw.battle[cat] ?? [])) {
        for (const id of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (id) oldAssigned.add(String(id));
        }
      }
    }
    const { date, enemyClan, result, battle, finalBattle, completed } = safeBody as {
      date?: string; enemyClan?: string | null; result?: string;
      battle?: any; finalBattle?: any; completed?: boolean;
    };
    if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) sw.date = new Date(date + 'T12:00:00Z');
    if (enemyClan !== undefined) (sw as any).enemyClan = enemyClan || null;
    if (result    !== undefined) sw.result = result as any;
    if (battle    !== undefined) sw.battle = battle;
    if (finalBattle !== undefined) (sw as any).finalBattle = finalBattle;
    if (completed !== undefined) sw.completed = completed;
    const updated    = await sw.save();
    const updatedPop = await pop(ShadowWar.findById(updated._id));
    const newlyAssigned: Array<{_id: unknown; name?: string}> = [];
    for (const cat of ['exalted', 'eminent', 'famed', 'proud'] as const) {
      for (const match of ((updatedPop as unknown as {battle: unknown}).battle as Record<string, Array<{group1:{character:Array<{_id?:unknown;name?:string}>};group2:{character:Array<{_id?:unknown;name?:string}>}}>>)[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char as {_id: unknown; name?: string});
        }
      }
    }
    if (newlyAssigned.length > 0) {
      try {
        const { getIO } = await import('../../socket');
        const User = (await import('../../models/User')).default;
        const io   = getIO();
        const confirmedIds = new Set((((updatedPop as unknown as {confirmed?: unknown[]}).confirmed) ?? []).map((c: unknown) => String((c as {_id?:unknown})?._id ?? c)));
        for (const char of newlyAssigned) {
          if (confirmedIds.has(String(char._id))) continue;
          const owner = await User.findOne({ character: char._id });
          if (owner) io.to(`user:${String(owner._id)}`).emit('shadowwar:assigned', { id: `shadowwar:${String(updated._id)}:${String(char._id)}`, shadowWarId: String(updated._id), characterId: String(char._id), characterName: char.name, date: updated.date });
        }
      } catch (e) { console.error('shadowwar:assigned socket error:', e); }
    }
    try {
      const { getIO } = await import('../../socket');
      const swClanId = String((updatedPop as unknown as { clan?: unknown }).clan ?? '');
      if (swClanId) getIO().to(`clan:${swClanId}`).except(`user:${String(req.user!._id)}`).emit('shadowwar:updated', { shadowWarId: String(updated._id) });
    } catch (e) { console.warn('shadowwar:updated socket error:', (e as Error).message); }
    res.status(200).json(updatedPop);
  } catch (err) { res.status(500).json({ error: message.user.error, details: (err as Error).message }); }
});

router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const charIds = req.user!.character.map(String);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    const assigned = new Set<string>();
    for (const cat of ['exalted', 'eminent', 'famed', 'proud'] as const) {
      for (const match of sw.battle[cat] ?? []) {
        for (const id of [...(match.group1.character ?? []), ...(match.group2.character ?? [])]) {
          if (charIds.includes(String(id))) assigned.add(String(id));
        }
      }
    }
    if (!assigned.size) { res.status(400).json({ message: 'No tienes personajes asignados.' }); return; }
    const confirmed = new Set(sw.confirmed.map(String));
    for (const id of assigned) { if (!confirmed.has(id)) sw.confirmed.push(id as unknown as typeof sw.confirmed[0]); }
    await sw.save();
    res.status(200).json({ message: 'Participación confirmada.' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const charIds = req.user!.character.map(String);
    const { characterId, action } = req.body as { characterId?: string; action?: string };
    const charId = characterId && charIds.includes(String(characterId)) ? String(characterId) : charIds[0];
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }

    const act = action ?? 'confirm';
    if (act === 'confirm') {
      sw.declined  = sw.declined.filter(id => String(id) !== charId) as typeof sw.declined;
      if (!sw.confirmed.some(id => String(id) === charId)) sw.confirmed.push(charId as unknown as typeof sw.confirmed[0]);
    } else if (act === 'decline') {
      sw.confirmed = sw.confirmed.filter(id => String(id) !== charId) as typeof sw.confirmed;
      if (!sw.declined.some(id => String(id) === charId)) sw.declined.push(charId as unknown as typeof sw.declined[0]);
    } else if (act === 'pending') {
      sw.confirmed = sw.confirmed.filter(id => String(id) !== charId) as typeof sw.confirmed;
      sw.declined  = sw.declined.filter(id => String(id) !== charId) as typeof sw.declined;
    }

    await sw.save();
    try {
      const { getIO } = await import('../../socket');
      const clanId = String(sw.clan ?? '');
      if (clanId) getIO().to(`clan:${clanId}`).emit('shadowwar:updated', { shadowWarId: String(sw._id) });
    } catch (e) { console.warn('shadowwar:respond socket error:', (e as Error).message); }
    res.status(200).json({ confirmed: true });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!isAdmin(req.user!)) {
      const clanId = await resolveClanForWrite(req.user!, (req.query.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String((sw as unknown as {clan?: unknown}).clan ?? '') !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    await ShadowWar.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Shadow War deleted' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
