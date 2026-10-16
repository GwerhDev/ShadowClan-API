import { Router, type Request, type Response } from 'express';
import ShadowWar from '../../models/ShadowWar';
import ClanPost  from '../../models/ClanPost';
import { message } from '../../messages';
import {
  resolveClanRead, resolveClanWrite, canAccessClanDoc,
  ownsCharacter, isCharacterInClan, isLeaderOrOfficerOf,
} from '../../helpers/clanScope';
import { handleError, parse } from '../../helpers/http';
import * as V from '../../validation/schemas';
import { populateShadowWar as pop, applyResponse, SW_CATEGORIES } from '../../helpers/activity';
import { emitToClan, emitToCharacterOwners } from '../../socket';
import { completeExpiredActivities, completeExpiredById, isPastActivityDate } from '../../helpers/autoComplete';

const router = Router();


router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    await completeExpiredActivities(clanId);
    const filter = clanId ? { clan: clanId } : {};
    const total  = await ShadowWar.countDocuments(filter);
    const data   = await ShadowWar.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).populate('enemyClan');
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch (err) { handleError(res, err); }
});

router.get('/by-date', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const dateStr = req.query.date as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? '')) { res.status(400).json({ message: 'date (YYYY-MM-DD) requerido.' }); return; }
    const start = new Date(dateStr + 'T00:00:00.000Z');
    const end   = new Date(dateStr + 'T23:59:59.999Z');
    await completeExpiredActivities(clanId);
    const filter = clanId ? { clan: clanId, date: { $gte: start, $lte: end } } : { date: { $gte: start, $lte: end } };
    const sw = await pop(ShadowWar.findOne(filter));
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    res.status(200).json(sw);
  } catch (err) { handleError(res, err); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await completeExpiredById('shadow_war', req.params.id);
    const sw = await pop(ShadowWar.findById(req.params.id));
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!(await canAccessClanDoc(req.user!, (sw as { clan?: unknown }).clan, req.query.characterId as string, 'read'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }
    res.status(200).json(sw);
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, date, enemyClan } = parse(V.shadowWarCreate, req.body);
    const clanId = await resolveClanWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const emptyMatches = () => Array(3).fill(null).map(() => ({ group1: { character: [] }, group2: { character: [] }, result: 'pending' }));
    const newSW = await new ShadowWar({ clan: clanId ?? null, date: new Date(date + 'T12:00:00Z'), enemyClan: enemyClan ?? null, confirmed: [], result: 'pending', battle: { exalted: emptyMatches(), eminent: emptyMatches(), famed: emptyMatches(), proud: emptyMatches() } }).save();
    const populated = await pop(ShadowWar.findById(newSW._id));
    try {
      // El autor del llamado a las armas es el personaje activo (si es líder/oficial del clan).
      if (clanId && await isLeaderOrOfficerOf(characterId, clanId)) {
        await ClanPost.create({ clan: clanId, author: characterId, content: '', source: 'shadow_war', referenceId: newSW._id, auto: true });
      }
    } catch (e) { console.error('call-to-arms (shadow_war):', e); }
    res.status(201).json(populated);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, date, enemyClan, result, battle, finalBattle } = parse(V.shadowWarPatch, req.body);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!(await canAccessClanDoc(req.user!, sw.clan, characterId, 'write'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }
    const oldAssigned = new Set<string>();
    for (const cat of SW_CATEGORIES) {
      for (const match of (sw.battle[cat] ?? [])) {
        for (const id of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (id) oldAssigned.add(String(id));
        }
      }
    }
    if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) sw.date = new Date(date + 'T12:00:00Z');
    if (enemyClan !== undefined) (sw as any).enemyClan = enemyClan || null;
    if (result    !== undefined) sw.result = result;
    if (battle    !== undefined) sw.battle = battle as any;
    if (finalBattle !== undefined) (sw as any).finalBattle = finalBattle;
    // `completed` no se edita a mano: depende de la fecha (helpers/autoComplete).
    if (date !== undefined) sw.completed = isPastActivityDate(sw.date);
    const updated    = await sw.save();
    const updatedPop = await pop(ShadowWar.findById(updated._id));
    const newlyAssigned: Array<{_id: unknown; name?: string}> = [];
    for (const cat of SW_CATEGORIES) {
      for (const match of ((updatedPop as unknown as {battle: unknown}).battle as Record<string, Array<{group1:{character:Array<{_id?:unknown;name?:string}>};group2:{character:Array<{_id?:unknown;name?:string}>}}>>)[cat] ?? []) {
        for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
          if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char as {_id: unknown; name?: string});
        }
      }
    }
    if (newlyAssigned.length > 0) {
      const confirmedIds = new Set((((updatedPop as unknown as {confirmed?: unknown[]}).confirmed) ?? []).map((c: unknown) => String((c as {_id?:unknown})?._id ?? c)));
      await emitToCharacterOwners('shadowwar:assigned', newlyAssigned
        .filter(char => !confirmedIds.has(String(char._id)))
        .map(char => ({
          characterId: char._id,
          payload: { id: `shadowwar:${String(updated._id)}:${String(char._id)}`, shadowWarId: String(updated._id), characterId: String(char._id), characterName: char.name, date: updated.date },
        })));
    }
    emitToClan((updatedPop as { clan?: unknown }).clan, 'shadowwar:updated', { shadowWarId: String(updated._id) }, req.user!._id);
    res.status(200).json(updatedPop);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const charIds = req.user!.character.map(String);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    const assigned = new Set<string>();
    for (const cat of SW_CATEGORIES) {
      for (const match of sw.battle[cat] ?? []) {
        for (const id of [...(match.group1.character ?? []), ...(match.group2.character ?? [])]) {
          if (charIds.includes(String(id))) assigned.add(String(id));
        }
      }
    }
    if (!assigned.size) { res.status(400).json({ message: 'No tienes personajes asignados.' }); return; }
    for (const id of assigned) applyResponse(sw, id, 'confirm');
    await sw.save();
    emitToClan(sw.clan, 'shadowwar:updated', { shadowWarId: String(sw._id) });
    res.status(200).json({ message: 'Participación confirmada.' });
  } catch (err) { handleError(res, err); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, action } = parse(V.respond, req.body);
    if (!ownsCharacter(req.user!, characterId)) { res.status(403).json({ message: 'El personaje no te pertenece.' }); return; }
    const charId = String(characterId);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!(await isCharacterInClan(charId, sw.clan))) { res.status(403).json({ message: message.admin.permissionDenied }); return; }

    applyResponse(sw, charId, action);
    await sw.save();
    emitToClan(sw.clan, 'shadowwar:updated', { shadowWarId: String(sw._id) });
    res.status(200).json({ confirmed: true });
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (!(await canAccessClanDoc(req.user!, sw.clan, req.query.characterId as string, 'write'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }
    await ShadowWar.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Shadow War deleted' });
  } catch (err) { handleError(res, err); }
});

export default router;
