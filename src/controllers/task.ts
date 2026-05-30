import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import Task from '../models/Task';
import CompletedTask from '../models/CompletedTask';
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

    const { date, type, character } = (req.body ?? {}) as { date?: string; type?: string; character?: string };

    const fixedTasks = await Task.find({ fixed: true, type });
    const userTasks  = character
      ? await Task.find({ date: new Date(date ?? ''), character, type })
      : await Task.find({ date: new Date(date ?? ''), user: user._id, type });

    const completedList = character
      ? await CompletedTask.find({ character, date: new Date(date ?? ''), type })
      : await CompletedTask.find({ user: user._id, date: new Date(date ?? ''), type });

    const allTasks = [...fixedTasks, ...userTasks];
    const formatted = allTasks.map(task => ({
      _id:       task._id,
      title:     task.title,
      date:      task.date,
      fixed:     task.fixed,
      completed: completedList.some(ct => ct.tasks.some(id => String(id) === String(task._id))),
    }));

    res.status(200).json(formatted);
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    const task = new Task(req.body);
    await task.save();
    res.status(200).json({ message: message.task.created });
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

router.patch('/update/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    await Task.findByIdAndUpdate(req.params.id, req.body);
    res.status(200).json({ message: message.task.updated });
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decoded = await getDecoded(req);
    const user = await User.findOne({ _id: decoded.data.id });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    await Task.deleteOne({ _id: req.params.id });
    await CompletedTask.updateMany({ tasks: req.params.id }, { $pull: { tasks: req.params.id } });
    res.status(200).json({ message: message.task.deleted });
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
