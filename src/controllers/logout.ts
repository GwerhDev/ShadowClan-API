import { Router, type Request, type Response } from 'express';
import { clientUrl } from '../config';
import { endSession } from '../helpers/session';
import { handleError } from '../helpers/http';

const router = Router();

// Cierra la sesión de este dispositivo (revoca su refresh token) y limpia las cookies.
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    await endSession(req, res);
    res.status(200).json({ redirectUrl: `${clientUrl}/login` });
  } catch (err) { handleError(res, err, 'GET /logout'); }
});

export default router;
