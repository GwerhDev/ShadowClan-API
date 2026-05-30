import { Router, type Request, type Response } from 'express';
import Warband from '../../models/Warband';
import { message } from '../../messages';

const router = Router();

// Note: auth is handled by the admin router's superAdminOnly middleware
router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, leader } = req.body as { name?: string; leader?: unknown };
    const warband = new Warband({ name, leader });
    await warband.save();
    res.status(201).json(warband);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await Warband.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(updated);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await Warband.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Warband eliminada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
