import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];

    if (!token) { res.status(401).json({ logged: false, message: message.user.unauthorized }); return; }

    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id)
      .populate('character')
      .populate({ path: 'character', populate: { path: 'clan' } });

    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }

    const [username, discriminator] = user.battletag.split('#');
    res.status(200).json({
      logged: true,
      userData: {
        id:            user._id,
        battletag:     user.battletag,
        username,
        discriminator,
        role:          user.role,
        phone:         user.phone,
        status:        user.status,
        character:     user.character,
      },
    });
  } catch {
    res.status(500).json({ logged: false, message: message.user.unauthorized });
  }
});

router.delete('/account', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id);
    if (!user) { res.status(404).json({ message: message.user.notfound }); return; }

    await User.findByIdAndDelete(user._id);
    res.clearCookie('u_tkn');

    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      for (const admin of admins) {
        io.to(`dashboard:${String(admin._id)}`).emit('admin:user:deleted', { id: String(user._id) });
      }
    } catch (e) {
      console.warn('Socket notification failed:', (e as Error).message);
    }

    res.status(200).json({ message: 'Cuenta eliminada' });
  } catch {
    res.status(500).json({ message: message.user.unauthorized });
  }
});

export default router;
