import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import Crest from '../models/Crest';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';

const router = Router();

async function getDecoded(req: Request) {
  const token = (req.cookies as Record<string, string>)['u_tkn'] ?? req.headers.authorization?.split(' ')[1];
  return decodeToken(token);
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const { date, character } = (req.body ?? {}) as { date?: string; character?: string };
    const response = character
      ? await Crest.find({ character, date: new Date(date ?? '') })
      : await Crest.find({ user: user._id, date: new Date(date ?? '') });
    res.status(200).json(response);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/counter', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const { character } = (req.body ?? {}) as { character?: string };
    const response = character ? await Crest.find({ character }) : await Crest.find({ user: user._id });
    res.status(200).json(response);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const { type, date, quantity, legendaryFound, character } = req.body as Record<string, unknown>;
    const crest = new Crest(character ? { type, date, quantity, legendaryFound, character } : { type, date, quantity, legendaryFound, user: user._id });
    await crest.save();
    res.status(201).json(crest);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const { type, date, quantity, legendaryFound, character } = req.body as Record<string, unknown>;
    const filter = character ? { _id: req.params.id, character, date } : { _id: req.params.id, user: user._id, date };
    const updated = await Crest.findOneAndUpdate(filter, { type, quantity, legendaryFound }, { new: true });
    res.status(200).json(updated);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    await Crest.findOneAndDelete({ _id: req.params.id });
    res.status(200).json({ message: message.crest.delete.success });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
