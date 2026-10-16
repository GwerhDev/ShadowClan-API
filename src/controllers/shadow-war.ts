import { Router, type Request, type Response } from 'express';
import ShadowWar from '../models/ShadowWar';
import { requireAuth } from '../middlewares';
import { resolveClanRead, ownsCharacter, isCharacterInClan } from '../helpers/clanScope';
import { populateShadowWar, applyResponse, SW_CATEGORIES } from '../helpers/activity';
import { handleError, badRequest, forbidden, notFound } from '../helpers/http';
import { emitToClan } from '../socket';

const router = Router();

router.use(requireAuth);

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.query as { characterId?: string };
    if (!characterId) { res.json(null); return; }
    // Solo personajes propios (salvo admins); sin clan → null.
    const clanId = await resolveClanRead(req.user!, characterId);
    if (!clanId) { res.json(null); return; }
    const base = { clan: clanId, completed: { $ne: true } };
    let sw = await populateShadowWar(ShadowWar.findOne({ ...base, date: { $gte: new Date() } }).sort({ date: 1 }));
    if (!sw) sw = await populateShadowWar(ShadowWar.findOne(base).sort({ date: -1 }));
    res.json(sw ?? null);
  } catch (err) { handleError(res, err, 'GET /shadow-war/active'); }
});

router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const charIds = req.user!.character.map(String);
    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) throw notFound('Shadow War not found');

    const assigned = new Set<string>();
    for (const cat of SW_CATEGORIES) {
      for (const match of sw.battle[cat] ?? []) {
        for (const id of [...(match.group1.character ?? []), ...(match.group2.character ?? [])]) {
          if (charIds.includes(String(id))) assigned.add(String(id));
        }
      }
    }
    if (!assigned.size) throw badRequest('No tienes personajes asignados.');

    for (const id of assigned) applyResponse(sw, id, 'confirm');
    await sw.save();
    emitToClan(sw.clan, 'shadowwar:updated', { shadowWarId: String(sw._id) });
    res.status(200).json({ message: 'Participación confirmada.' });
  } catch (err) { handleError(res, err, 'PATCH /shadow-war/:id/confirm'); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, action } = req.body as { characterId?: string; action?: string };
    if (!characterId) throw badRequest('characterId requerido');
    if (!ownsCharacter(req.user!, characterId)) throw forbidden('El personaje no te pertenece');

    const sw = await ShadowWar.findById(req.params.id);
    if (!sw) throw notFound('Shadow War not found');
    if (!(await isCharacterInClan(characterId, sw.clan))) throw forbidden('El personaje no pertenece al clan de esta actividad');

    applyResponse(sw, characterId, action);
    await sw.save();
    emitToClan(sw.clan, 'shadowwar:updated', { shadowWarId: String(sw._id) });
    res.status(200).json({ message: 'Participación actualizada.' });
  } catch (err) { handleError(res, err, 'POST /shadow-war/:id/respond'); }
});

export default router;
