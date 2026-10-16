import { Router, type Request, type Response } from 'express';
import ClanCreationRequest from '../models/ClanCreationRequest';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';
import { handleError } from '../helpers/http';
import { notifyAdmins } from '../socket';

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
      await notifyAdmins('admin:request:new', {
        type: 'clan-creation', id: String(request._id),
        clanName: request.clanName, user: { battletag: user.battletag },
      });
    } catch (e) { console.warn('clan-creation socket failed:', (e as Error).message); }

    res.status(201).json(request);
  } catch (err) { handleError(res, err); }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    const requests = await ClanCreationRequest.find({ user: user._id }).sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (err) { handleError(res, err); }
});

export default router;
