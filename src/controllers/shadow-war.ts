import { Router, type Request, type Response } from 'express';
import ShadowWar from '../models/ShadowWar';
import Character from '../models/Character';

const router = Router();

const populate = (q: ReturnType<typeof ShadowWar.findById>) => q
  .populate('confirmed').populate('enemyClan')
  .populate('battle.exalted.group1.character').populate('battle.exalted.group2.character')
  .populate('battle.eminent.group1.character').populate('battle.eminent.group2.character')
  .populate('battle.famed.group1.character').populate('battle.famed.group2.character')
  .populate('battle.proud.group1.character').populate('battle.proud.group2.character');

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.query as { characterId?: string };
    if (!characterId) { res.json(null); return; }
    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.json(null); return; }
    const now = new Date();
    const base = { clan: char.clan, completed: { $ne: true } };
    let sw = await populate(ShadowWar.findOne({ ...base, date: { $gte: now } }).sort({ date: 1 }) as ReturnType<typeof ShadowWar.findById>);
    if (!sw) sw = await populate(ShadowWar.findOne(base) as ReturnType<typeof ShadowWar.findById>);
    res.json(sw ?? null);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener la guerra sombría activa.', error: (err as Error).message });
  }
});

router.patch('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const { decodeToken } = await import('../integrations/jwt');
    const User   = (await import('../models/User')).default;
    const token  = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ message: 'No autorizado' }); return; }
    const decoded = await decodeToken(token);
    const user    = await User.findById(decoded.data.id);
    if (!user) { res.status(401).json({ message: 'No autorizado' }); return; }

    const charIds = user.character.map(String);
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
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor', message: (err as Error).message });
  }
});

export default router;
