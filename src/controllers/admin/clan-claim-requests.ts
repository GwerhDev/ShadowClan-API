import { Router, type Request, type Response } from 'express';
import ClanClaimRequest from '../../models/ClanClaimRequest';
import Clan             from '../../models/Clan';
import Character        from '../../models/Character';
import { message }      from '../../messages';
import { Types }        from 'mongoose';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const requests = await ClanClaimRequest.find({ status: 'pending' })
      .populate('user', 'battletag')
      .populate('character', 'name')
      .populate('clan', 'name status')
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: 'accept' | 'reject' };
    if (!action || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida' }); return;
    }

    const request = await ClanClaimRequest.findById(req.params.id)
      .populate('user', '_id battletag')
      .populate('character', '_id name')
      .populate('clan', '_id name status leader officer member');
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    if (action === 'accept') {
      const clan    = request.clan as unknown as { _id: unknown; leader?: unknown; officer: unknown[]; member: unknown[]; status: string };
      const charId  = (request.character as unknown as { _id: unknown })._id;
      const clanDoc = await Clan.findById(clan._id);
      if (clanDoc) {
        if (request.requestedRole === 'leader') {
          clanDoc.leader = charId as typeof clanDoc.leader;
          clanDoc.member = clanDoc.member.filter(m => String(m) !== String(charId));
        } else {
          if (!clanDoc.officer.some(o => String(o) === String(charId))) {
            clanDoc.officer.push(charId as Types.ObjectId);
          }
          clanDoc.member = clanDoc.member.filter(m => String(m) !== String(charId));
        }
        clanDoc.status = 'claimed';
        await clanDoc.save();
        await Character.findByIdAndUpdate(charId, { clan: clanDoc._id });
      }
    }

    const owner = request.user as unknown as { _id: unknown };
    try {
      const { getIO } = await import('../../socket');
      const clanName = (request.clan as unknown as { name: string }).name;
      getIO().to(`user:${String(owner._id)}`).emit('clan-claim-request:reviewed', {
        id: String(request._id), action, requestedRole: request.requestedRole, clanName,
      });
    } catch { /* */ }

    request.status = action === 'accept' ? 'accepted' : 'rejected';
    await request.save();
    res.status(200).json({ message: action === 'accept' ? 'Solicitud aprobada.' : 'Solicitud rechazada.' });
  } catch (err) { res.status(500).json({ error: message.user.error, details: (err as Error).message }); }
});

export default router;
