import { Router, type Request, type Response } from 'express';
import ClanCreationRequest from '../models/ClanCreationRequest';
import User from '../models/User';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { clanName, characterId } = req.body as { clanName?: string; characterId?: string };
    if (!clanName?.trim()) { res.status(400).json({ message: 'El nombre del clan es obligatorio' }); return; }
    if (!characterId) { res.status(400).json({ message: 'Se requiere un personaje activo' }); return; }

    const charIds = user.character.map(String);
    if (!charIds.includes(String(characterId))) { res.status(403).json({ message: 'No autorizado' }); return; }

    const existing = await ClanCreationRequest.findOne({ user: user._id, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya tienes una solicitud de clan pendiente' }); return; }

    const request = await ClanCreationRequest.create({ user: user._id, character: characterId, clanName: clanName.trim() });

    // Notify admins via socket
    try {
      const { getIO } = await import('../socket');
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      const io = getIO();
      for (const admin of admins) {
        io.to(`dashboard:${String(admin._id)}`).emit('admin:request:new', {
          type: 'clan-creation', id: String(request._id),
          clanName: request.clanName, user: { battletag: user.battletag },
        });
      }
    } catch (e) { console.warn('clan-creation socket failed:', (e as Error).message); }

    res.status(201).json(request);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    const requests = await ClanCreationRequest.find({ user: user._id }).sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
