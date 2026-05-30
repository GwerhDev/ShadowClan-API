import { Router, type Request, type Response } from 'express';
import ShadowWar     from '../../models/ShadowWar';
import AccursedTower from '../../models/AccursedTower';
import Character     from '../../models/Character';
import { message }   from '../../messages';
import type { IUser } from '../../types';

const router = Router();

function isAdmin(user: IUser) { return user.role === 'admin' || user.role === 'super_admin'; }

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const skip  = (page - 1) * limit;
    const type  = (req.query.type as string) || 'all';

    let clanFilter: Record<string, unknown> = {};
    if (!isAdmin(req.user!)) {
      const { characterId } = req.query as { characterId?: string };
      if (!characterId) { res.status(200).json({ total: 0, page, limit, pages: 0, data: [] }); return; }
      const char = await Character.findById(characterId).select('clan');
      if (!char?.clan) { res.status(200).json({ total: 0, page, limit, pages: 0, data: [] }); return; }
      clanFilter = { clan: char.clan };
    }

    if (type === 'shadow_war') {
      const total = await ShadowWar.countDocuments(clanFilter);
      const data  = await ShadowWar.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'shadow_war' })) });
      return;
    }

    if (type === 'accursed_tower') {
      const total = await AccursedTower.countDocuments(clanFilter);
      const data  = await AccursedTower.find(clanFilter).sort({ date: -1 }).skip(skip).limit(limit).populate('enemyClan');
      res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: data.map(d => ({ ...d.toObject(), type: 'accursed_tower' })) });
      return;
    }

    const [swAll, atAll] = await Promise.all([
      ShadowWar.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
      AccursedTower.find(clanFilter).sort({ date: -1 }).populate('enemyClan'),
    ]);
    const combined = [
      ...swAll.map(d => ({ ...d.toObject(), type: 'shadow_war' as const })),
      ...atAll.map(d => ({ ...d.toObject(), type: 'accursed_tower' as const })),
    ].sort((a, b) => new Date(b.date as Date).getTime() - new Date(a.date as Date).getTime());

    res.status(200).json({ total: combined.length, page, limit, pages: Math.ceil(combined.length / limit), data: combined.slice(skip, skip + limit) });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
