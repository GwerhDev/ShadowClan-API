import { Router, type Request, type Response } from 'express';
import ClanRequest from '../../models/ClanRequest';
import User from '../../models/User';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import { openMembership } from '../../helpers/clanMembership';
import { roles } from '../../misc/consts-user-model';
import { handleError } from '../../helpers/http';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'pending', unclaimedOnly } = req.query as { status?: string; unclaimedOnly?: string };
    let filter: Record<string, unknown> = { status };

    if (unclaimedOnly === 'true') {
      const unclaimedClans = await Clan.find({ status: { $ne: 'claimed' } }).select('_id').lean();
      filter.clan = { $in: unclaimedClans.map(c => c._id) };
    }

    const requests = await ClanRequest.find(filter)
      .populate('user', 'battletag')
      .populate('character', 'name currentClass')
      .populate('clan', 'name status')
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (err) { handleError(res, err); }
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
      const target = await Character.findById(request.character).select('clan');
      if (target?.clan && String(target.clan) !== String(request.clan)) {
        res.status(409).json({ message: 'El personaje ya pertenece a otro clan' }); return;
      }
      // Solo un walker pasa a `user`; nunca degradar a leader/officer/admin.
      await User.updateOne({ _id: request.user, role: roles.walker }, { role: roles.user });
      await Clan.updateOne({ _id: request.clan }, { $addToSet: { member: request.character } });
      await Character.updateOne({ _id: request.character }, { clan: request.clan });
      await openMembership(request.character, request.clan, 'member');
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }
    // Capture user ID before populate changes the reference
    const userId = String(request.user);
    await request.save();
    await request.populate([{ path: 'user', select: 'battletag' }, { path: 'character', select: 'name' }, { path: 'clan', select: 'name' }]);

    // Notify the requesting user
    try {
      const { getIO } = await import('../../socket');
      const clanName = (request.clan as unknown as { name?: string }).name ?? '';
      getIO().to(`user:${userId}`).emit('clan-request:reviewed', {
        id: String(request._id), action, clan: { name: clanName },
      });
    } catch (e) { console.warn('Socket notify failed:', (e as Error).message); }

    res.status(200).json({ message: action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada', request });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
