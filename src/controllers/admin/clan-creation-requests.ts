import { Router, type Request, type Response } from 'express';
import ClanCreationRequest from '../../models/ClanCreationRequest';
import Clan from '../../models/Clan';

import { message } from '../../messages';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const requests = await ClanCreationRequest.find({ status: 'pending' })
      .populate('user', 'battletag')
      .populate('character', 'name')
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: 'accept' | 'reject' };
    if (!action || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida. Use accept o reject' }); return;
    }

    const request = await ClanCreationRequest.findById(req.params.id)
      .populate('user', '_id battletag role character')
      .populate('character', '_id name');
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    if (action === 'accept') {
      // Create the clan and add the requesting character as member
      const charId = request.character as unknown as { _id?: unknown } | string;
      const charIdStr = typeof charId === 'object' ? String((charId as { _id?: unknown })?._id ?? charId) : String(charId);

      const clan = await new Clan({ name: request.clanName, member: [charIdStr] }).save();

      // Set Character.clan
      const Character = (await import('../../models/Character')).default;
      await Character.findByIdAndUpdate(charIdStr, { clan: clan._id });

      // Notify the user
      try {
        const { getIO } = await import('../../socket');
        const owner = request.user as unknown as { _id: unknown };
        getIO().to(`user:${String(owner._id)}`).emit('clan-creation-request:reviewed', {
          id: String(request._id), action: 'accept', clanName: request.clanName, clanId: String(clan._id),
        });
      } catch { /* socket failure never breaks response */ }
    } else {
      try {
        const { getIO } = await import('../../socket');
        const owner = request.user as unknown as { _id: unknown };
        getIO().to(`user:${String(owner._id)}`).emit('clan-creation-request:reviewed', {
          id: String(request._id), action: 'reject', clanName: request.clanName,
        });
      } catch { /* */ }
    }

    request.status = action === 'accept' ? 'accepted' : 'rejected';
    await request.save();
    res.status(200).json({ message: action === 'accept' ? 'Clan creado.' : 'Solicitud rechazada.' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
