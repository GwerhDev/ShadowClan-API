import { Router, type Request, type Response } from 'express';
import ClanRequest from '../../models/ClanRequest';
import User from '../../models/User';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import { message } from '../../messages';
import { roles } from '../../misc/consts-user-model';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'pending' } = req.query as { status?: string };
    const requests = await ClanRequest.find({ status })
      .populate('user', 'battletag')
      .populate('character', 'name currentClass')
      .populate('clan', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: string };
    if (!action || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' }); return;
    }
    const request = await ClanRequest.findById(req.params.id);
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    if (action === 'accept') {
      await User.updateOne({ _id: request.user }, { role: roles.user });
      await Clan.updateOne({ _id: request.clan }, { $push: { member: request.character } });
      await Character.updateOne({ _id: request.character }, { clan: request.clan });
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }
    await request.save();
    await request.populate([{ path: 'user', select: 'battletag' }, { path: 'character', select: 'name' }, { path: 'clan', select: 'name' }]);
    res.status(200).json({ message: action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada', request });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
