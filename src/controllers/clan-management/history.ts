import { Router, type Request, type Response } from 'express';
import ShadowWar     from '../../models/ShadowWar';
import AccursedTower from '../../models/AccursedTower';
import VigilOfBlades from '../../models/VigilOfBlades';
import Clan          from '../../models/Clan';
import { resolveClanRead, resolveClanWrite } from '../../helpers/clanScope';
import { handleError } from '../../helpers/http';
import { completeExpiredActivities } from '../../helpers/autoComplete';

const router = Router();

type HistoryType = 'shadow_war' | 'accursed_tower' | 'vigil_of_blades';
const HISTORY_SOURCES: Array<{ type: HistoryType; Model: typeof ShadowWar }> = [
  { type: 'shadow_war',      Model: ShadowWar },
  { type: 'accursed_tower',  Model: AccursedTower as unknown as typeof ShadowWar },
  { type: 'vigil_of_blades', Model: VigilOfBlades },
];

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const skip  = (page - 1) * limit;
    const type  = (req.query.type as string) || 'all';
    const q     = (req.query.q as string)?.trim();

    // characterId debe pertenecer al usuario (salvo admins). Sin clan → vacío.
    // Admins sin characterId → sin filtro (caso Dashboard).
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string | undefined);
    if (clanId === false) { res.status(200).json({ total: 0, page, limit, pages: 0, data: [] }); return; }
    await completeExpiredActivities(clanId);
    let clanFilter: Record<string, unknown> = clanId ? { clan: clanId } : {};

    // Search by enemy clan name
    if (q) {
      const matchingClans = await Clan.find({ name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).select('_id').lean();
      const ids = matchingClans.map(c => c._id);
      clanFilter = { ...clanFilter, enemyClan: { $in: ids } };
    }

    // Fuentes del historial; `type` filtra a una, 'all' las combina por fecha.
    const sources = HISTORY_SOURCES.filter(src => type === 'all' || src.type === type);
    if (!sources.length) { res.status(400).json({ message: 'Tipo inválido.' }); return; }

    // Los primeros (skip + limit) del listado combinado están siempre dentro de los
    // primeros (skip + limit) de cada colección → no hace falta cargar todo en memoria.
    const window = skip + limit;
    const perSource = await Promise.all(sources.map(async src => {
      const [count, top] = await Promise.all([
        src.Model.countDocuments(clanFilter),
        src.Model.find(clanFilter).sort({ date: -1 }).limit(window).populate('enemyClan'),
      ]);
      return { count, items: top.map(d => ({ ...d.toObject(), type: src.type })) };
    }));
    const combined = perSource.flatMap(p => p.items)
      .sort((a, b) => new Date(b.date as Date).getTime() - new Date(a.date as Date).getTime());

    const total = perSource.reduce((sum, p) => sum + p.count, 0);
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data: combined.slice(skip, skip + limit) });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, type, date, enemyClanName, result, towerNumber } =
      req.body as { characterId?: string; type?: string; date?: string; enemyClanName?: string; result?: string; towerNumber?: number };

    if (!type || !['shadow_war', 'accursed_tower'].includes(type)) {
      res.status(400).json({ message: 'Tipo inválido. Use shadow_war o accursed_tower' }); return;
    }

    if (!characterId) { res.status(400).json({ message: 'Se requiere characterId' }); return; }
    // Verifica que el personaje activo sea líder/oficial de su clan (admins: solo que tenga clan).
    const clanId = await resolveClanWrite(req.user!, characterId);
    if (!clanId) { res.status(403).json({ message: 'Solo líderes y oficiales pueden agregar historial' }); return; }

    // Find or create enemy clan
    let enemyClanId: unknown = null;
    if (enemyClanName?.trim()) {
      const name    = enemyClanName.trim();
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let enemy = await Clan.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } });
      if (!enemy) enemy = await new Clan({ name }).save();
      enemyClanId = enemy._id;
    }

    const parsedDate = date ? new Date(date) : new Date();
    const validResult = ['victory', 'defeat', 'draw'].includes(result ?? '') ? result : 'pending';

    if (type === 'shadow_war') {
      const empty = () => Array(3).fill(null).map(() => ({ group1: { character: [] }, group2: { character: [] }, result: 'pending' }));
      const sw = await new ShadowWar({
        clan: clanId, date: parsedDate, enemyClan: enemyClanId,
        result: validResult, completed: true, confirmed: [],
        battle: { exalted: empty(), eminent: empty(), famed: empty(), proud: empty() },
      }).save();
      const populated = await ShadowWar.findById(sw._id).populate('enemyClan');
      res.status(201).json({ ...populated!.toObject(), type: 'shadow_war' }); return;
    }

    const tower = await new AccursedTower({
      clan: clanId, date: parsedDate, enemyClan: enemyClanId,
      towerNumber: towerNumber ?? 1, result: validResult,
      completed: true, roster: { group1: [], group2: [], group3: [] },
    }).save();
    const populated = await AccursedTower.findById(tower._id).populate('enemyClan');
    res.status(201).json({ ...populated!.toObject(), type: 'accursed_tower' });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
