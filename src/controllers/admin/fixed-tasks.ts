import { Router, type Request, type Response } from 'express';
import Task from '../../models/Task';
import { message } from '../../messages';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.body as { type?: string };
    const tasks = await Task.find({ type });
    res.status(200).json(tasks);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const task = new Task(req.body);
    await task.save();
    res.status(200).json(task);
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
