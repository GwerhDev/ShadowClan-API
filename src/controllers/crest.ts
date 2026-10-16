import { Router, type Request, type Response } from 'express';
import Crest from '../models/Crest';
import { message } from '../messages';
import { requireAuth } from '../middlewares';
import { ownerFilter, anyOwnedFilter, parseDate } from '../helpers/ownerScope';
import { handleError } from '../helpers/http';

const router = Router();

router.use(requireAuth);

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, character } = (req.body ?? {}) as { date?: string; character?: string };
    const owner = ownerFilter(req.user!, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const day = parseDate(date);
    if (!day) { res.status(400).json({ message: 'date requerido.' }); return; }
    res.status(200).json(await Crest.find({ ...owner, date: day }));
  } catch (err) { handleError(res, err); }
});

router.post('/counter', async (req: Request, res: Response): Promise<void> => {
  try {
    const { character } = (req.body ?? {}) as { character?: string };
    const owner = ownerFilter(req.user!, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    res.status(200).json(await Crest.find(owner));
  } catch (err) { handleError(res, err); }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, date, quantity, legendaryFound, character } = req.body as Record<string, unknown>;
    const owner = ownerFilter(req.user!, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const day = parseDate(date);
    if (!day || !type) { res.status(400).json({ message: 'date y type son requeridos.' }); return; }
    const crest = await new Crest({ type: String(type), date: day, quantity: Number(quantity) || 0, legendaryFound: !!legendaryFound, ...owner }).save();
    res.status(201).json(crest);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, quantity, legendaryFound } = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (type           !== undefined) update.type           = String(type);
    if (quantity       !== undefined) update.quantity       = Number(quantity) || 0;
    if (legendaryFound !== undefined) update.legendaryFound = !!legendaryFound;
    const updated = await Crest.findOneAndUpdate({ _id: req.params.id, ...anyOwnedFilter(req.user!) }, update, { new: true });
    if (!updated) { res.status(404).json({ message: 'Registro no encontrado.' }); return; }
    res.status(200).json(updated);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Crest.findOneAndDelete({ _id: req.params.id, ...anyOwnedFilter(req.user!) });
    if (!deleted) { res.status(404).json({ message: 'Registro no encontrado.' }); return; }
    res.status(200).json({ message: message.crest.delete.success });
  } catch (err) { handleError(res, err); }
});

export default router;
