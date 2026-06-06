import { Router, type Request, type Response } from 'express';
import AccursedTower from '../models/AccursedTower';
import Character    from '../models/Character';

const router = Router();

async function populateRosters(towers: any[]): Promise<any[]> {
  const allIds = new Set<string>();
  for (const t of towers) {
    for (const grp of ['group1', 'group2', 'group3'] as const) {
      for (const id of (t.roster?.[grp] ?? [])) if (id) allIds.add(String(id));
    }
  }
  const chars = allIds.size
    ? await Character.find({ _id: { $in: [...allIds] } }).select('name currentClass score clan').lean()
    : [];
  const charMap = new Map(chars.map(c => [String((c as any)._id), c]));
  const mapGroup = (g: any[]) => (g ?? []).map((id: any) => id ? (charMap.get(String(id)) ?? null) : null);
  return towers.map(t => {
    const obj = t.toObject ? t.toObject() : { ...t };
    if (obj.roster) obj.roster = { group1: mapGroup(obj.roster.group1), group2: mapGroup(obj.roster.group2), group3: mapGroup(obj.roster.group3) };
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

router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  try {
    const { decodeToken } = await import('../integrations/jwt');
    const User  = (await import('../models/User')).default;
    const token = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ message: 'No autorizado' }); return; }
    const decoded = await decodeToken(token);
    const user    = await User.findById(decoded.data.id);
    if (!user) { res.status(401).json({ message: 'No autorizado' }); return; }

    const { characterId, action } = req.body as { characterId?: string; action?: string };
    if (!characterId) { res.status(400).json({ message: 'characterId requerido' }); return; }
    if (!user.character.map(String).includes(characterId)) {
      res.status(403).json({ message: 'El personaje no te pertenece' }); return;
    }

    const tower = await AccursedTower.findById(req.params.id);
    if (!tower) { res.status(404).json({ message: 'Torre no encontrada.' }); return; }

    const charRef = characterId as unknown as typeof tower.confirmed[0];
    const act = action ?? 'confirm';

    if (act === 'confirm') {
      tower.declined  = tower.declined.filter(id => String(id) !== characterId) as typeof tower.declined;
      if (!tower.confirmed.some(id => String(id) === characterId)) tower.confirmed.push(charRef);
    } else if (act === 'decline') {
      tower.confirmed = tower.confirmed.filter(id => String(id) !== characterId) as typeof tower.confirmed;
      if (!tower.declined.some(id => String(id) === characterId)) tower.declined.push(charRef);
    } else {
      tower.confirmed = tower.confirmed.filter(id => String(id) !== characterId) as typeof tower.confirmed;
      tower.declined  = tower.declined.filter(id => String(id) !== characterId) as typeof tower.declined;
    }

    await tower.save();
    try {
      const { getIO } = await import('../socket');
      const clanId = String(tower.clan ?? '');
      if (clanId) getIO().to(`clan:${clanId}`).emit('tower:updated', { towerId: String(tower._id) });
    } catch (e) { console.warn('tower:respond socket error:', (e as Error).message); }
    res.status(200).json({ message: 'Participación actualizada.' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor', message: (err as Error).message });
  }
});

export default router;
