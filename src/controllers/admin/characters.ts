import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import Character from '../../models/Character';
import Clan from '../../models/Clan';
import { message } from '../../messages';
import { characterConsts } from '../../misc/consts-models';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};
    const chars = await Character.find(query).populate('clan', 'name')
      .limit(parseInt(limit ?? '10', 10)).skip((parseInt(page ?? '1', 10) - 1) * parseInt(limit ?? '10', 10));
    res.status(200).json(chars);
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, resonance, currentClass } = req.body as { name?: string; resonance?: number; currentClass?: string };
    if (!name) { res.status(400).json({ error: 'El nombre del personaje es obligatorio' }); return; }
    const char = await Character.create({ name, resonance, currentClass });
    res.status(201).json({ message: message.character.create.success, character: char });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { _id } = req.body as { _id?: string };
    const updated = await Character.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updated) { res.status(404).json({ message: message.member.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/claim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, characterId } = req.body as { userId?: string; characterId?: string };
    const updChar = await Character.findByIdAndUpdate(characterId, { status: characterConsts.status.claimed }, { new: true });
    if (!updChar) { res.status(404).json({ message: message.member.notfound }); return; }
    const updUser = await User.findByIdAndUpdate(userId, { $push: { character: characterId } }, { new: true });
    if (!updUser) { res.status(404).json({ message: message.user.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find(), users: await User.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/unclaim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, characterId } = req.body as { userId?: string; characterId?: string };
    const updChar = await Character.findByIdAndUpdate(characterId, { status: characterConsts.status.unclaimed }, { new: true });
    if (!updChar) { res.status(404).json({ message: message.member.notfound }); return; }
    const updUser = await User.findByIdAndUpdate(userId, { $pull: { character: characterId } }, { new: true });
    if (!updUser) { res.status(404).json({ message: message.user.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find(), users: await User.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/:id/remove-clan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const char = await Character.findById(id).populate('clan', 'name');
    if (!char) { res.status(404).json({ message: message.member.notfound }); return; }
    const clanName = (char.clan as unknown as { name?: string } | undefined)?.name ?? null;
    if (char.clan) await Clan.updateOne({ _id: char.clan }, { $pull: { member: char._id, officer: char._id } });
    const updated = await Character.findByIdAndUpdate(id, { clan: null }, { new: true });
    if (clanName) {
      try {
        const { getIO } = await import('../../socket');
        const owner = await User.findOne({ character: id }).select('_id');
        if (owner) getIO().to(`user:${String(owner._id)}`).emit('clan:member-removed', { clanName, characterId: id });
      } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    }
    res.status(200).json({ message: 'Personaje retirado del clan', character: updated });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/:id/unclaim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const char = await Character.findById(id);
    if (!char) { res.status(404).json({ message: message.member.notfound }); return; }
    await User.updateMany({ character: id }, { $pull: { character: id } });
    if (char.clan) await Clan.updateOne({ _id: char.clan }, { $pull: { member: char._id, officer: char._id } });
    const updated = await Character.findByIdAndUpdate(id, { status: 'unclaimed', clan: null }, { new: true });
    res.status(200).json({ message: 'Personaje desvinculado', character: updated });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Character.findByIdAndDelete(req.params.id);
    if (!deleted) { res.status(404).json({ message: message.member.notfound }); return; }
    res.status(200).json({ message: message.character.delete.success });
  } catch { res.status(500).json({ error: message.member.error }); }
});

export default router;
