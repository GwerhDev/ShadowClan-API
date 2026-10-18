import { Router, type Request, type Response } from 'express';
import AccursedTower from '../../models/AccursedTower';
import Clan          from '../../models/Clan';
import ClanPost      from '../../models/ClanPost';
import { message }   from '../../messages';
import {
  resolveClanRead, resolveClanWrite, canAccessClanDoc,
  ownsCharacter, isCharacterInClan, isLeaderOrOfficerOf, escapeRegex,
} from '../../helpers/clanScope';
import { handleError, parse } from '../../helpers/http';
import * as V from '../../validation/schemas';
import { populateTower as pop, applyResponse } from '../../helpers/activity';
import { emitToClan, emitToCharacterOwners } from '../../socket';
import { completeExpiredActivities, completeExpiredById, isPastActivityDate } from '../../helpers/autoComplete';

const router = Router();


router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, (req.query.characterId as string));
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    await completeExpiredActivities(clanId);
    const filter = { completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    const towers = await pop(AccursedTower.find(filter).sort({ date: 1 }));
    res.status(200).json(towers);
  } catch (err) { handleError(res, err); }
});

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, (req.query.characterId as string));
    // Sin clan resoluble (o personaje ajeno) → vacío; nunca devolver torres de otros clanes.
    if (clanId === false) { res.status(200).json([]); return; }
    await completeExpiredActivities(clanId);
    const baseFilter = { active: true, completed: { $ne: true }, ...(clanId ? { clan: clanId } : {}) };
    // Las vencidas ya se completaron arriba (completeExpiredActivities), así que la activa es
    // la no completada más antigua. No usar `date >= now`: las instancias se guardan a las
    // 12:00Z (09:00 local) y la de hoy dejaría de cumplirlo desde esa hora.
    const towers = await pop(AccursedTower.find(baseFilter).sort({ date: 1 }));
    res.status(200).json(towers);
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, towerNumber, date, enemyClan } = parse(V.towerCreate, req.body);
    const clanId = await resolveClanWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const tower = await new AccursedTower({ clan: clanId ?? null, towerNumber, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : new Date(date), enemyClan: enemyClan ?? null, roster: { group1: [], group2: [], group3: [] } }).save();
    const populated = await pop(AccursedTower.findById(tower._id));
    try {
      // El autor del llamado a las armas es el personaje activo (si es líder/oficial del clan).
      if (clanId && await isLeaderOrOfficerOf(characterId, clanId)) {
        await ClanPost.create({ clan: clanId, author: characterId, content: '', source: 'accursed_tower', referenceId: tower._id, auto: true });
      }
    } catch (e) { console.error('call-to-arms (accursed_tower):', e); }
    res.status(201).json(populated);
  } catch (err) { handleError(res, err); }
});

router.get('/clans', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query as { q?: string };
    if (!q?.trim()) { res.status(200).json([]); return; }
    const clans = await Clan.find({ name: { $regex: escapeRegex(q.trim()), $options: 'i' } }).limit(10).lean();
    res.status(200).json(clans);
  } catch (err) { handleError(res, err); }
});

router.post('/clans', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, name } = req.body as { characterId?: string; name?: string };
    const clanId = await resolveClanWrite(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!name?.trim()) { res.status(400).json({ message: 'Nombre requerido.' }); return; }
    const existing = await Clan.findOne({ name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' } });
    if (existing) { res.status(409).json({ message: 'Ya existe un clan con ese nombre.' }); return; }
    res.status(201).json(await new Clan({ name: name.trim() }).save());
  } catch (err) { handleError(res, err); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, action } = parse(V.respond, req.body);
    if (!ownsCharacter(req.user!, characterId)) { res.status(403).json({ message: 'El personaje no te pertenece.' }); return; }
    const charId = String(characterId);
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!(await isCharacterInClan(charId, tower.clan))) { res.status(403).json({ message: message.admin.permissionDenied }); return; }

    applyResponse(tower, charId, action);
    await tower.save();
    emitToClan(tower.clan, 'tower:updated', { towerId: String(tower._id) });
    res.status(200).json({ confirmed: true });
  } catch (err) { handleError(res, err); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await completeExpiredById('accursed_tower', req.params.id);
    const tower = await pop(AccursedTower.findById(req.params.id));
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!(await canAccessClanDoc(req.user!, (tower as { clan?: unknown }).clan, req.query.characterId as string, 'read'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }
    res.status(200).json(tower);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    const { characterId, towerNumber, date, roster, enemyClan, result, finalRoster } = parse(V.towerPatch, req.body);
    if (!(await canAccessClanDoc(req.user!, tower.clan, characterId, 'write'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }

    const oldAssigned = new Set<string>();
    for (const g of ['group1', 'group2', 'group3'] as const) {
      for (const id of (tower.roster?.[g] ?? [])) if (id) oldAssigned.add(String(id));
    }

    if (towerNumber !== undefined) tower.towerNumber = towerNumber;
    if (date !== undefined) tower.date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : new Date(date);
    if (enemyClan !== undefined) tower.enemyClan = (enemyClan ?? undefined) as any;
    if (roster)                  tower.roster      = roster as typeof tower.roster;
    if (finalRoster !== undefined) (tower as any).finalRoster = finalRoster;
    // `completed` no se edita a mano: depende de la fecha (helpers/autoComplete).
    if (date !== undefined) tower.completed = isPastActivityDate(tower.date);
    if (result !== undefined)    tower.result    = result;
    await tower.save();
    const updatedTower = await pop(AccursedTower.findById(tower._id));

    emitToClan(tower.clan, 'tower:updated', { towerId: String(tower._id) }, req.user!._id);

    if (roster) {
      const newlyAssigned: Array<{ _id: unknown; name?: string }> = [];
      for (const g of ['group1', 'group2', 'group3'] as const) {
        for (const char of ((updatedTower as any)?.roster?.[g] ?? [])) {
          if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char);
        }
      }
      await emitToCharacterOwners('tower:assigned', newlyAssigned.map(char => ({
        characterId: char._id,
        payload: {
          id: `tower:${String(tower._id)}:${String(char._id)}`,
          towerId: String(tower._id),
          characterId: String(char._id),
          characterName: char.name,
          towerNumber: (updatedTower as any)?.towerNumber,
          date: (updatedTower as any)?.date,
        },
      })));
    }

    res.status(200).json(updatedTower);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }
    if (!(await canAccessClanDoc(req.user!, tower.clan, req.query.characterId as string, 'write'))) {
      res.status(403).json({ message: message.admin.permissionDenied }); return;
    }
    await AccursedTower.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Torre eliminada.' });
  } catch (err) { handleError(res, err); }
});

export default router;
