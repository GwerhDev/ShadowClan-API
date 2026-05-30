import { Router, type Request, type Response } from 'express';
import CharacterClaim from '../../models/CharacterClaim';
import Character from '../../models/Character';
import User from '../../models/User';
import { message } from '../../messages';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'pending' } = req.query as { status?: string };
    const claims = await CharacterClaim.find({ status })
      .populate('user', 'battletag').populate('character', 'name currentClass resonance').sort({ createdAt: -1 });
    res.status(200).json(claims);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: string };
    if (!action || !['accept', 'reject'].includes(action)) { res.status(400).json({ message: 'Acción inválida.' }); return; }
    const claim = await CharacterClaim.findById(req.params.id);
    if (!claim) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (claim.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    if (action === 'accept') {
      await Character.updateOne({ _id: claim.character }, { status: 'claimed' });
      await User.updateOne({ _id: claim.user }, { $addToSet: { character: claim.character } });
      claim.status = 'accepted';
    } else {
      await Character.updateOne({ _id: claim.character }, { status: 'unclaimed' });
      claim.status = 'rejected';
    }
    await claim.save();
    const populated = await CharacterClaim.findById(claim._id).populate('user', 'battletag').populate('character', 'name currentClass resonance');

    try {
      const { getIO } = await import('../../socket');
      getIO().to(`user:${String(claim.user)}`).emit('character-request:reviewed', {
        id: String(claim._id), action, type: 'claim', character: populated?.character, createdAt: claim.createdAt,
      });
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }

    res.status(200).json({ message: action === 'accept' ? 'Vinculación aprobada' : 'Vinculación rechazada', claim: populated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
