import { Router, type Request, type Response } from 'express';
import CompletedTask from '../models/CompletedTask';
import { message } from '../messages';
import { requireAuth } from '../middlewares';
import { ownerFilter, parseDate } from '../helpers/ownerScope';
import { handleError } from '../helpers/http';

const router = Router();

router.use(requireAuth);

router.post('/create/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };
    const owner = ownerFilter(req.user!, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const day = parseDate(date);
    if (!day || !type) { res.status(400).json({ message: 'date y type son requeridos.' }); return; }

    // Upsert + $addToSet: idempotente y sin duplicar la tarea en el día.
    await CompletedTask.findOneAndUpdate(
      { ...owner, date: day, type },
      { $addToSet: { tasks: id } },
      { upsert: true },
    );

    res.status(200).json({ message: message.task.updated });
  } catch (err) { handleError(res, err); }
});

router.patch('/delete/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };
    const owner = ownerFilter(req.user!, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const day = parseDate(date);
    if (!day || !type) { res.status(400).json({ message: 'date y type son requeridos.' }); return; }

    await CompletedTask.findOneAndUpdate({ ...owner, date: day, type }, { $pull: { tasks: id } });
    res.status(200).json({ message: message.task.updated });
  } catch (err) { handleError(res, err); }
});

export default router;
