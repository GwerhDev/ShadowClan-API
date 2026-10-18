/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Request, type Response } from 'express';
import ClanPost from '../../models/ClanPost';
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
import type { SWKindConfig } from '../../helpers/activityKinds';

/**
 * Router de gestión (líderes/oficiales) para instancias con formación de Guerra Sombría.
 * Se instancia por tipo: /clan-management/shadow-wars y /clan-management/vigil-of-blades.
 */
export function createSWManagementRouter(cfg: SWKindConfig): Router {
  const router = Router();
  const { Model, kind, notFound, events } = cfg;
  const idPayload = (id: unknown) => ({ [events.idKey]: String(id) });

  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const clanId = await resolveClanRead(req.user!, (req.query.characterId as string));
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
      const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
      await completeExpiredActivities(clanId);
      const filter = clanId ? { clan: clanId } : {};
      const total  = await Model.countDocuments(filter);
      const data   = await Model.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).populate('enemyClan');
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
      const doc = await pop(Model.findOne(filter) as any);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      res.status(200).json(doc);
    } catch (err) { handleError(res, err); }
  });

  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      await completeExpiredById(kind, req.params.id);
      const doc = await pop(Model.findById(req.params.id) as any);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      if (!(await canAccessClanDoc(req.user!, (doc as { clan?: unknown }).clan, req.query.characterId as string, 'read'))) {
        res.status(403).json({ message: message.admin.permissionDenied }); return;
      }
      res.status(200).json(doc);
    } catch (err) { handleError(res, err); }
  });

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { characterId, date, enemyClan } = parse(V.shadowWarCreate, req.body);
      const clanId = await resolveClanWrite(req.user!, characterId);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      const emptyMatches = () => Array(3).fill(null).map(() => ({ group1: { character: [] }, group2: { character: [] }, result: 'pending' }));
      const created = await new Model({
        clan: clanId ?? null, date: new Date(date + 'T12:00:00Z'), enemyClan: enemyClan ?? null, confirmed: [], result: 'pending',
        battle: { exalted: emptyMatches(), eminent: emptyMatches(), famed: emptyMatches(), proud: emptyMatches() },
      }).save();
      const populated = await pop(Model.findById(created._id) as any);
      try {
        // El autor del llamado a las armas es el personaje activo (si es líder/oficial del clan).
        if (clanId && await isLeaderOrOfficerOf(characterId, clanId)) {
          await ClanPost.create({ clan: clanId, author: characterId, content: '', source: cfg.postSource, referenceId: created._id, auto: true });
        }
      } catch (e) { console.error(`call-to-arms (${kind}):`, e); }
      emitToClan(clanId, events.updated, idPayload(created._id), req.user!._id);
      res.status(201).json(populated);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { characterId, date, enemyClan, result, battle, finalBattle } = parse(V.shadowWarPatch, req.body);
      const doc = await Model.findById(req.params.id);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      if (!(await canAccessClanDoc(req.user!, doc.clan, characterId, 'write'))) {
        res.status(403).json({ message: message.admin.permissionDenied }); return;
      }
      const oldAssigned = new Set<string>();
      for (const cat of SW_CATEGORIES) {
        for (const match of (doc.battle[cat] ?? [])) {
          for (const id of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
            if (id) oldAssigned.add(String(id));
          }
        }
      }
      if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) doc.date = new Date(date + 'T12:00:00Z');
      if (enemyClan !== undefined) (doc as any).enemyClan = enemyClan || null;
      if (result    !== undefined) doc.result = result;
      if (battle    !== undefined) doc.battle = battle as any;
      if (finalBattle !== undefined) (doc as any).finalBattle = finalBattle;
      // `completed` no se edita a mano: depende de la fecha (helpers/autoComplete).
      if (date !== undefined) doc.completed = isPastActivityDate(doc.date, new Date(), kind);
      const updated    = await doc.save();
      const updatedPop = await pop(Model.findById(updated._id) as any);
      const newlyAssigned: Array<{ _id: unknown; name?: string }> = [];
      for (const cat of SW_CATEGORIES) {
        for (const match of ((updatedPop as any).battle?.[cat] ?? [])) {
          for (const char of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
            if (char?._id && !oldAssigned.has(String(char._id))) newlyAssigned.push(char);
          }
        }
      }
      if (newlyAssigned.length > 0) {
        const confirmedIds = new Set(((updatedPop as any).confirmed ?? []).map((c: any) => String(c?._id ?? c)));
        await emitToCharacterOwners(events.assigned, newlyAssigned
          .filter(char => !confirmedIds.has(String(char._id)))
          .map(char => ({
            characterId: char._id,
            payload: {
              id: `${kind}:${String(updated._id)}:${String(char._id)}`,
              ...idPayload(updated._id),
              characterId: String(char._id), characterName: char.name, date: updated.date,
            },
          })));
      }
      emitToClan((updatedPop as { clan?: unknown }).clan, events.updated, idPayload(updated._id), req.user!._id);
      res.status(200).json(updatedPop);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
    try {
      const charIds = req.user!.character.map(String);
      const doc = await Model.findById(req.params.id);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      const assigned = new Set<string>();
      for (const cat of SW_CATEGORIES) {
        for (const match of doc.battle[cat] ?? []) {
          for (const id of [...(match.group1.character ?? []), ...(match.group2.character ?? [])]) {
            if (charIds.includes(String(id))) assigned.add(String(id));
          }
        }
      }
      if (!assigned.size) { res.status(400).json({ message: 'No tienes personajes asignados.' }); return; }
      for (const id of assigned) applyResponse(doc, id, 'confirm');
      await doc.save();
      emitToClan(doc.clan, events.updated, idPayload(doc._id));
      res.status(200).json({ message: 'Participación confirmada.' });
    } catch (err) { handleError(res, err); }
  });

  router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
    try {
      const { characterId, action } = parse(V.respond, req.body);
      if (!ownsCharacter(req.user!, characterId)) { res.status(403).json({ message: 'El personaje no te pertenece.' }); return; }
      const charId = String(characterId);
      const doc = await Model.findById(req.params.id);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      if (!(await isCharacterInClan(charId, doc.clan))) { res.status(403).json({ message: message.admin.permissionDenied }); return; }

      applyResponse(doc, charId, action);
      await doc.save();
      emitToClan(doc.clan, events.updated, idPayload(doc._id));
      res.status(200).json({ confirmed: true });
    } catch (err) { handleError(res, err); }
  });

  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const doc = await Model.findById(req.params.id);
      if (!doc) { res.status(404).json({ message: notFound }); return; }
      if (!(await canAccessClanDoc(req.user!, doc.clan, req.query.characterId as string, 'write'))) {
        res.status(403).json({ message: message.admin.permissionDenied }); return;
      }
      await Model.findByIdAndDelete(req.params.id);
      emitToClan(doc.clan, events.updated, { ...idPayload(doc._id), deleted: true }, req.user!._id);
      res.status(200).json({ message: 'Instancia eliminada.' });
    } catch (err) { handleError(res, err); }
  });

  return router;
}
