import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import { status } from '../../misc/consts-user-model';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pendingUsers = await User.find({ status: status.pending });
    res.status(200).json({ pendingUsers, counter: pendingUsers.length });
  } catch (error) { res.status(500).json(error); }
});

export default router;
