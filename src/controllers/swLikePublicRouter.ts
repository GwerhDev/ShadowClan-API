import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middlewares';
import { resolveClanRead, ownsCharacter, isCharacterInClan } from '../helpers/clanScope';
import { populateShadowWar, applyResponse, SW_CATEGORIES } from '../helpers/activity';
import { handleError, badRequest, forbidden, notFound } from '../helpers/http';
import { emitToClan } from '../socket';
import { completeExpiredActivities } from '../helpers/autoComplete';
import type { SWKindConfig } from '../helpers/activityKinds';

/**
 * Vista de miembros para instancias con formación de Guerra Sombría: instancia activa
 * del clan del personaje, confirmar asignación y responder (confirmar/declinar).
 * Se instancia por tipo: /shadow-war y /vigil-of-blades.
 */
export function createSWPublicRouter(cfg: SWKindConfig): Router {
  const router = Router();
  const { Model, events } = cfg;
  const base = `/${cfg.kind === 'shadow_war' ? 'shadow-war' : 'vigil-of-blades'}`;
  const idPayload = (id: unknown) => ({ [events.idKey]: String(id) });

  router.use(requireAuth);

  router.get('/active', async (req: Request, res: Response): Promise<void> => {
    try {
      const { characterId } = req.query as { characterId?: string };
      if (!characterId) { res.json(null); return; }
      // Solo personajes propios (salvo admins); sin clan → null.
      const clanId = await resolveClanRead(req.user!, characterId);
      if (!clanId) { res.json(null); return; }
      await completeExpiredActivities(clanId);
      const filter = { clan: clanId, completed: { $ne: true } };
      let doc = await populateShadowWar(Model.findOne({ ...filter, date: { $gte: new Date() } }).sort({ date: 1 }) as never);
      if (!doc) doc = await populateShadowWar(Model.findOne(filter).sort({ date: -1 }) as never);
      res.json(doc ?? null);
    } catch (err) { handleError(res, err, `GET ${base}/active`); }
  });

  router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
    try {
      const charIds = req.user!.character.map(String);
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(cfg.notFound);

      const assigned = new Set<string>();
      for (const cat of SW_CATEGORIES) {
        for (const match of doc.battle[cat] ?? []) {
          for (const id of [...(match.group1.character ?? []), ...(match.group2.character ?? [])]) {
            if (charIds.includes(String(id))) assigned.add(String(id));
          }
        }
      }
      if (!assigned.size) throw badRequest('No tienes personajes asignados.');

      for (const id of assigned) applyResponse(doc, id, 'confirm');
      await doc.save();
      emitToClan(doc.clan, events.updated, idPayload(doc._id));
      res.status(200).json({ message: 'Participación confirmada.' });
    } catch (err) { handleError(res, err, `PATCH ${base}/:id/confirm`); }
  });

  router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
    try {
      const { characterId, action } = req.body as { characterId?: string; action?: string };
      if (!characterId) throw badRequest('characterId requerido');
      if (!ownsCharacter(req.user!, characterId)) throw forbidden('El personaje no te pertenece');

      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(cfg.notFound);
      if (!(await isCharacterInClan(characterId, doc.clan))) throw forbidden('El personaje no pertenece al clan de esta actividad');

      applyResponse(doc, characterId, action);
      await doc.save();
      emitToClan(doc.clan, events.updated, idPayload(doc._id));
      res.status(200).json({ message: 'Participación actualizada.' });
    } catch (err) { handleError(res, err, `POST ${base}/:id/respond`); }
  });

  return router;
}
