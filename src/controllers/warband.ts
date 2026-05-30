import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import Warband from '../models/Warband';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
    const decoded = await decodeToken(token);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const warbands = await Warband.find();
    res.status(200).json(warbands);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
