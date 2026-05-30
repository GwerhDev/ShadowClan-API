import { Router, type Request, type Response } from 'express';
import AccursedTower from '../models/AccursedTower';
import Character    from '../models/Character';

const router = Router();

const pop = (q: ReturnType<typeof AccursedTower.find> | ReturnType<typeof AccursedTower.findById>) =>
  (q as ReturnType<typeof AccursedTower.findById>)
    .populate('enemyClan').populate('roster.group1').populate('roster.group2').populate('roster.group3');

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.query as { characterId?: string };
    if (!characterId) { res.json([]); return; }
    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.json([]); return; }
    const base = { clan: char.clan, completed: { $ne: true } };
    const now  = new Date();
    let towers = await pop(AccursedTower.find({ ...base, date: { $gte: now } }).sort({ date: 1 }) as unknown as ReturnType<typeof AccursedTower.findById>);
    if (!(towers as unknown[]).length) towers = await pop(AccursedTower.find(base).sort({ date: -1 }) as unknown as ReturnType<typeof AccursedTower.findById>);
    res.json(towers);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener torres activas.', error: (err as Error).message });
  }
});

router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const { decodeToken } = await import('../integrations/jwt');
    const User  = (await import('../models/User')).default;
    const token = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ message: 'No autorizado' }); return; }
    const decoded = await decodeToken(token);
    const user    = await User.findById(decoded.data.id);
    if (!user) { res.status(401).json({ message: 'No autorizado' }); return; }

    const { characterId } = req.body as { characterId?: string };
    const charIds = user.character.map(String);
    const charId  = characterId && charIds.includes(String(characterId)) ? String(characterId) : charIds[0];
    const tower   = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }

    const already = new Set((tower.confirmed ?? []).map(String));
    if (!already.has(charId)) { tower.confirmed.push(charId as unknown as typeof tower.confirmed[0]); await tower.save(); }
    res.status(200).json({ message: 'Participación confirmada.' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor', message: (err as Error).message });
  }
});

export default router;
