import { Router, type Request, type Response } from 'express';
import CharacterCreationRequest from '../../models/CharacterCreationRequest';
import Character from '../../models/Character';
import User from '../../models/User';
import { message } from '../../messages';
import { roles } from '../../misc/consts-user-model';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'pending' } = req.query as { status?: string };
    const requests = await CharacterCreationRequest.find({ status }).populate('user', 'battletag role').sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action?: string };
    if (!action || !['accept', 'reject'].includes(action)) { res.status(400).json({ message: 'Acción inválida.' }); return; }

    const request = await CharacterCreationRequest.findById(req.params.id).populate('user', 'battletag role');
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    const userId = (request.user as unknown as { _id: unknown })._id;

    if (action === 'accept') {
      const char = await Character.create({ name: request.name, currentClass: request.currentClass, resonance: request.resonance, status: 'claimed' });
      await User.updateOne({ _id: userId }, { $push: { character: char._id }, role: roles.user });
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }
    await request.save();

    try {
      const { getIO } = await import('../../socket');
      getIO().to(`user:${String(userId)}`).emit('character-request:reviewed', {
        id: String(request._id), action, type: 'creation',
        character: { name: request.name, currentClass: request.currentClass, resonance: request.resonance },
        createdAt: request.createdAt,
      });
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }

    res.status(200).json({ message: action === 'accept' ? 'Personaje creado y vinculado' : 'Solicitud rechazada', request });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
