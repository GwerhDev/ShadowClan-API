import { Router, type Request, type Response } from 'express';
import Clan from '../models/Clan';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ message: message.admin.permissionDenied }); return; }
    try { await decodeToken(token); } catch { res.status(401).json({ message: message.admin.permissionDenied }); return; }

    const { name } = req.query as { name?: string };
    const query = name ? { name: { $regex: name, $options: 'i' } } : {};
    const clans = await Clan.find(query).select('_id name');
    res.status(200).json(clans);
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
