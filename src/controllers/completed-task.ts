import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import CompletedTask from '../models/CompletedTask';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';

const router = Router();

async function getDecoded(req: Request) {
  const token = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
  return decodeToken(token);
}

router.post('/create/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }

    const id = req.params.id;
    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };

    const filter = character
      ? { date: new Date(date ?? ''), character, type }
      : { date: new Date(date ?? ''), user: user._id, type };

    const existing = await CompletedTask.findOne(filter);
    if (!existing) {
      await CompletedTask.create({ tasks: [id], date: new Date(date ?? ''), type, ...(character ? { character } : { user: user._id }) });
    } else {
      await CompletedTask.findByIdAndUpdate(existing._id, { $push: { tasks: id } });
    }

    res.status(200).json({ message: message.task.updated });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/delete/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }

    const id = req.params.id;
    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };

    const filter = character
      ? { date: new Date(date ?? ''), character, type }
      : { date: new Date(date ?? ''), user: user._id, type };

    await CompletedTask.findOneAndUpdate(filter, { $pull: { tasks: id } });
    res.status(200).json({ message: message.task.updated });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
