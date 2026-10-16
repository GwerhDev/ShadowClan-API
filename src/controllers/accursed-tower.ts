import { Router, type Request, type Response } from 'express';
import AccursedTower from '../models/AccursedTower';
import { requireAuth } from '../middlewares';
import { resolveClanRead, ownsCharacter, isCharacterInClan } from '../helpers/clanScope';
import { populateTower, applyResponse } from '../helpers/activity';
import { handleError, badRequest, forbidden, notFound } from '../helpers/http';
import { emitToClan } from '../socket';

const router = Router();

router.use(requireAuth);

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.query as { characterId?: string };
    if (!characterId) { res.json([]); return; }
    // Solo personajes propios (salvo admins); sin clan → [].
    const clanId = await resolveClanRead(req.user!, characterId);
    if (!clanId) { res.json([]); return; }
    const base = { clan: clanId, completed: { $ne: true } };
    let towers = await populateTower(AccursedTower.find({ ...base, date: { $gte: new Date() } }).sort({ date: 1 }));
    if (!(towers as unknown[]).length) towers = await populateTower(AccursedTower.find(base).sort({ date: -1 }));
    res.json(towers);
  } catch (err) { handleError(res, err, 'GET /accursed-tower/active'); }
});

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, action } = req.body as { characterId?: string; action?: string };
    if (!characterId) throw badRequest('characterId requerido');
    if (!ownsCharacter(req.user!, characterId)) throw forbidden('El personaje no te pertenece');

    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) throw notFound('Torre no encontrada.');
    if (!(await isCharacterInClan(characterId, tower.clan))) throw forbidden('El personaje no pertenece al clan de esta actividad');

    applyResponse(tower, characterId, action);
    await tower.save();
    emitToClan(tower.clan, 'tower:updated', { towerId: String(tower._id) });
    res.status(200).json({ message: 'Participación actualizada.' });
  } catch (err) { handleError(res, err, 'POST /accursed-tower/:id/respond'); }
});

export default router;
