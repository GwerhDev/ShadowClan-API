import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';
import Character from '../models/Character';
import Clan from '../models/Clan';
import { closeMembership } from '../helpers/clanMembership';
import { requireAuth } from '../middlewares';
import { handleError } from '../helpers/http';
import { notifyAdmins } from '../socket';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];

    if (!token) { res.status(401).json({ logged: false, message: message.user.unauthorized }); return; }

    let decoded;
    try { decoded = await decodeToken(token); }
    catch { res.status(401).json({ logged: false, message: message.user.unauthorized }); return; }
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
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/account', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Liberar personajes: cerrar membresías, sacarlos de los clanes y dejarlos sin reclamar.
    if (user.character?.length) {
      const chars = await Character.find({ _id: { $in: user.character } }).select('clan');
      await Promise.all(chars.filter(c => c.clan).map(c => closeMembership(c._id, c.clan!, { removedBy: user._id })));
      await Clan.updateMany({}, { $pull: { member: { $in: user.character }, officer: { $in: user.character } } });
      await Clan.updateMany({ leader: { $in: user.character } }, { $unset: { leader: '' }, status: 'unclaimed' });
      await Character.updateMany({ _id: { $in: user.character } }, { $unset: { clan: '' }, status: 'unclaimed' });
    }

    await User.findByIdAndDelete(user._id);
    res.clearCookie('u_tkn');

    try {
      await notifyAdmins('admin:user:deleted', { id: String(user._id) });
    } catch (e) {
      console.warn('Socket notification failed:', (e as Error).message);
    }

    res.status(200).json({ message: 'Cuenta eliminada' });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
