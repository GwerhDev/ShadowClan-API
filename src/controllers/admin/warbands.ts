import { Router, type Request, type Response } from 'express';
import Warband from '../../models/Warband';
import { handleError } from '../../helpers/http';

const router = Router();

// Auth: montado bajo /admin (admin | super_admin).
router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, leader } = req.body as { name?: string; leader?: unknown };
    const warband = new Warband({ name, leader });
    await warband.save();
    res.status(201).json(warband);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, leader } = req.body as { name?: string; leader?: unknown };
    const update: Record<string, unknown> = {};
    if (name   !== undefined) update.name   = String(name);
    if (leader !== undefined) update.leader = leader;
    const updated = await Warband.findByIdAndUpdate(req.params.id, update, { new: true });
    res.status(200).json(updated);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await Warband.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Warband eliminada' });
  } catch (err) { handleError(res, err); }
});

export default router;
