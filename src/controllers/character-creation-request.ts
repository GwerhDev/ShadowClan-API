import { Router, type Request, type Response } from 'express';
import CharacterCreationRequest from '../models/CharacterCreationRequest';
import User from '../models/User';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { name, currentClass, resonance } = req.body as { name?: string; currentClass?: string; resonance?: number };
    if (!name || !currentClass) { res.status(400).json({ message: 'Nombre y clase son obligatorios' }); return; }

    const existing = await CharacterCreationRequest.findOne({ user: user._id, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya tienes una solicitud de creación pendiente' }); return; }

    const request = await CharacterCreationRequest.create({ user: user._id, name, currentClass, resonance });

    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      for (const admin of admins) {
        io.to(`dashboard:${String(admin._id)}`).emit('admin:request:new', {
          type: 'character-creation', id: String(request._id),
          user: { battletag: user.battletag }, character: { name, currentClass, resonance }, createdAt: request.createdAt,
        });
      }
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }

    res.status(201).json({ message: 'Solicitud de creación enviada', request });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    const requests = await CharacterCreationRequest.find({ user: user._id }).sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
