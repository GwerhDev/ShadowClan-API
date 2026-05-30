import { Router, type Request, type Response } from 'express';
import CharacterClaim from '../models/CharacterClaim';
import Character from '../models/Character';
import User from '../models/User';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { characterId } = req.body as { characterId?: string };
    if (!characterId) { res.status(400).json({ message: 'Se requiere el ID del personaje' }); return; }

    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Personaje no encontrado' }); return; }
    if (char.status !== 'unclaimed') { res.status(409).json({ message: 'El personaje no está disponible para reclamar' }); return; }

    const existing = await CharacterClaim.findOne({ character: characterId, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya hay una solicitud pendiente para este personaje' }); return; }

    const claim = await CharacterClaim.create({ user: user._id, character: characterId });
    await Character.updateOne({ _id: characterId }, { status: 'pending' });
    await claim.populate('character', 'name currentClass resonance');

    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      for (const admin of admins) {
        io.to(`dashboard:${String(admin._id)}`).emit('admin:request:new', {
          type: 'character-claim', id: String(claim._id),
          character: claim.character, user: { battletag: user.battletag }, createdAt: claim.createdAt,
        });
      }
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }

    res.status(201).json({ message: 'Solicitud de vinculación enviada', claim });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    const claims = await CharacterClaim.find({ user: user._id }).populate('character', 'name currentClass resonance').sort({ createdAt: -1 });
    res.status(200).json(claims);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
