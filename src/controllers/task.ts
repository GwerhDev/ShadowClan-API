import { Router, type Request, type Response } from 'express';
import Task from '../models/Task';
import CompletedTask from '../models/CompletedTask';
import { message } from '../messages';
import { requireAuth } from '../middlewares';
import { ownerFilter, anyOwnedFilter, parseDate } from '../helpers/ownerScope';
import { handleError } from '../helpers/http';

const router = Router();

router.use(requireAuth);

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };
    const owner = ownerFilter(user, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const day = parseDate(date);
    if (!day || !type) { res.status(400).json({ message: 'date y type son requeridos.' }); return; }

    const [fixedTasks, userTasks, completedList] = await Promise.all([
      Task.find({ fixed: true, type }),
      Task.find({ ...owner, date: day, type }),
      CompletedTask.find({ ...owner, date: day, type }),
    ]);

    const allTasks = [...fixedTasks, ...userTasks];
    const formatted = allTasks.map(task => ({
      _id:       task._id,
      title:     task.title,
      date:      task.date,
      fixed:     task.fixed,
      completed: completedList.some(ct => ct.tasks.some(id => String(id) === String(task._id))),
    }));

    res.status(200).json(formatted);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { title, type, date, character } = req.body as { title?: string; type?: string; date?: string; character?: string };
    const owner = ownerFilter(user, character);
    if (!owner) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!title?.trim() || !type) { res.status(400).json({ message: 'title y type son requeridos.' }); return; }
    // Las tareas fijas solo se crean desde el Dashboard (admin/fixed-tasks).
    await new Task({ title: title.trim(), type, date: parseDate(date) ?? undefined, fixed: false, ...owner }).save();
    res.status(200).json({ message: message.task.created });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/update/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, date } = req.body as { title?: string; date?: string };
    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = String(title).trim();
    if (date  !== undefined) update.date  = parseDate(date) ?? undefined;
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, fixed: { $ne: true }, ...anyOwnedFilter(req.user!) },
      update,
    );
    if (!task) { res.status(404).json({ message: 'Tarea no encontrada.' }); return; }
    res.status(200).json({ message: message.task.updated });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/delete/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, fixed: { $ne: true }, ...anyOwnedFilter(req.user!) });
    if (!task) { res.status(404).json({ message: 'Tarea no encontrada.' }); return; }
    await CompletedTask.updateMany({ tasks: req.params.id }, { $pull: { tasks: req.params.id } });
    res.status(200).json({ message: message.task.deleted });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
