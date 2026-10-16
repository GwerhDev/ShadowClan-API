import { Router, type Request, type Response } from 'express';
import ClanClaimRequest from '../models/ClanClaimRequest';
import Clan             from '../models/Clan';
import { message }      from '../messages';
import { getUser }      from '../helpers/getUser';
import { handleError } from '../helpers/http';
import { notifyAdmins } from '../socket';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { characterId, clanId, requestedRole } = req.body as { characterId?: string; clanId?: string; requestedRole?: string };
    if (!characterId || !clanId) { res.status(400).json({ message: 'Se requieren characterId y clanId' }); return; }
    if (!['leader', 'officer'].includes(requestedRole ?? '')) { res.status(400).json({ message: 'requestedRole debe ser leader u officer' }); return; }

    const charIds = user.character.map(String);
    if (!charIds.includes(String(characterId))) { res.status(403).json({ message: 'No autorizado' }); return; }

    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan no encontrado' }); return; }
    if (clan.status !== 'unclaimed') { res.status(409).json({ message: 'El clan ya tiene líderes asignados' }); return; }

    const existing = await ClanClaimRequest.findOne({ user: user._id, clan: clanId, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya tienes una solicitud pendiente para este clan' }); return; }

    const request = await ClanClaimRequest.create({
      user: user._id, character: characterId, clan: clanId, requestedRole,
    });

    // Notify admins
    try {
      await notifyAdmins('admin:request:new', {
        type: 'clan-claim', id: String(request._id),
        clanName: clan.name, requestedRole, user: { battletag: user.battletag },
      });
    } catch (e) { console.warn('clan-claim socket failed:', (e as Error).message); }

    res.status(201).json(request);
  } catch (err) { handleError(res, err); }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    const requests = await ClanClaimRequest.find({ user: user._id }).populate('clan', 'name').sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (err) { handleError(res, err); }
});

export default router;
