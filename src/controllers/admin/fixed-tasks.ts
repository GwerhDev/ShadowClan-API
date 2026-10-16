import { Router, type Request, type Response } from 'express';
import Task from '../../models/Task';
import { handleError } from '../../helpers/http';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.body as { type?: string };
    const tasks = await Task.find({ type });
    res.status(200).json(tasks);
  } catch (err) { handleError(res, err); }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const task = new Task(req.body);
    await task.save();
    res.status(200).json(task);
  } catch (err) { handleError(res, err); }
});

export default router;
