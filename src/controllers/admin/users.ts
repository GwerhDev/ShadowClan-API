import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import Character from '../../models/Character';
import Clan from '../../models/Clan';
import { message } from '../../messages';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) { res.status(500).json(error); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await User.findByIdAndUpdate(req.params.id, req.body);
    res.status(200).json({ message: message.admin.updateuser });
  } catch { res.status(500).json({ message: message.admin.updateuser }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: message.user.notfound }); return; }

    if (user.character.length) {
      await Character.updateMany({ _id: { $in: user.character } }, { status: 'unclaimed', clan: null });
      await Clan.updateMany({}, { $pull: { member: { $in: user.character }, officer: { $in: user.character } } });
    }

    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: message.admin.deleteuser });
  } catch { res.status(500).json({ message: message.admin.deleteuser }); }
});

export default router;
