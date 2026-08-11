import { Router, type Request, type Response } from 'express';
import ShadowWar from '../../models/ShadowWar';
import { message } from '../../messages';

const router = Router();

const populate = (q: ReturnType<typeof ShadowWar.findById>) => q
  .populate('enemyClan').populate('confirmed')
  .populate('battle.exalted.group1.character').populate('battle.exalted.group2.character')
  .populate('battle.eminent.group1.character').populate('battle.eminent.group2.character')
  .populate('battle.famed.group1.character').populate('battle.famed.group2.character')
  .populate('battle.proud.group1.character').populate('battle.proud.group2.character');

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = parseInt((req.query.page  as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '10', 10);
    const total = await ShadowWar.countDocuments();
    const data  = await ShadowWar.find().sort({ date: -1 }).skip((page - 1) * limit).limit(limit).populate('enemyClan');
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/by-date', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateStr = req.query.date as string;
    const start = new Date(dateStr + 'T00:00:00.000Z');
    const end   = new Date(dateStr + 'T23:59:59.999Z');
    const sw = await populate(ShadowWar.findOne({ date: { $gte: start, $lte: end } }) as ReturnType<typeof ShadowWar.findById>);
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    res.status(200).json(sw);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await populate(ShadowWar.findById(req.params.id));
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    res.status(200).json(sw);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = new ShadowWar(req.body);
    await sw.save();
    res.status(201).json(sw);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sw = await populate(ShadowWar.findById(req.params.id));
    if (!sw) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    if (req.body.enemyClan === '') req.body.enemyClan = null;
    Object.assign(sw, req.body);
    const updated = await (sw as unknown as { save(): Promise<unknown> }).save();
    res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error, details: (error as Error).message });
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await ShadowWar.findByIdAndDelete(req.params.id);
    if (!deleted) { res.status(404).json({ message: 'Shadow War not found' }); return; }
    res.status(200).json({ message: 'Shadow War deleted successfully' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
