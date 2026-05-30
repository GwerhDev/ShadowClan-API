import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import { message } from '../../messages';
import { status as userStatus } from '../../misc/consts-user-model';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find({ status: userStatus.pending }).select('battletag role status createdAt');
    res.status(200).json(users);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: string };
    if (!action || !['activate', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida. Usa "activate" o "reject"' }); return;
    }
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: 'Usuario no encontrado' }); return; }
    if (user.status !== userStatus.pending) { res.status(409).json({ message: 'El usuario ya fue procesado' }); return; }

    user.status = action === 'activate' ? userStatus.active : userStatus.inactive;
    await user.save();
    res.status(200).json({
      message: action === 'activate' ? 'Usuario activado' : 'Usuario rechazado',
      user: { _id: user._id, battletag: user.battletag, status: user.status },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
