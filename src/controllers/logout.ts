import { Router, type Request, type Response } from 'express';
import { clientUrl } from '../config';

const router = Router();

router.get('/', (_req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production') {
    res.clearCookie('u_tkn', { httpOnly: true, secure: true, sameSite: 'none', domain: '.shadowclan.cl', path: '/' });
  } else {
    res.clearCookie('u_tkn', { httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
  }
  res.status(200).json({ redirectUrl: `${clientUrl}/login` });
});

export default router;
