import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import User from '../models/User';
import { loginBnet } from '../integrations/bnet';
import { clientUrl, appClientUrl } from '../config';
import { createToken } from '../integrations/jwt';
import { status } from '../misc/consts-user-model';

passport.use('login-bnet', loginBnet as Parameters<typeof passport.use>[1]);

const router = Router();

router.get('/', (req: Request, res: Response, next: NextFunction): void => {
  req.session.save((err) => {
    if (err) { console.error('Session save error:', err); next(err); return; }
    (passport.authenticate as (strategy: string, options: unknown) => ReturnType<typeof passport.authenticate>)('login-bnet', { state: true })(req, res, next);
  });
});

router.get('/callback', (req: Request, res: Response, next: NextFunction): void => {
  (passport.authenticate('login-bnet', (err: Error | null, user: Express.User | false) => {
    if (err)   { console.error('Bnet auth error:', err);  res.redirect('/login-bnet/failure'); return; }
    if (!user) { res.redirect('/login-bnet/failure'); return; }
    req.logIn(user, (loginErr) => {
      if (loginErr) { console.error('Login error:', loginErr); res.redirect('/login-bnet/failure'); return; }
      res.redirect('/login-bnet/success');
    });
  }) as Parameters<typeof router.get>[1])(req, res, next);
});

router.get('/failure', (_req: Request, res: Response): void => {
  res.status(400).redirect(`${clientUrl}/login/login-error`);
});

router.get('/success', async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionUser = ((req.session as unknown) as { passport?: { user?: { battlenetId?: string } } }).passport?.user;
    if (!sessionUser?.battlenetId) { res.status(400).redirect(`${clientUrl}/login/user-not-found`); return; }

    const userExist = await User.findOne({ battlenetId: sessionUser.battlenetId });
    if (userExist?.status === status.pending)  { res.status(400).redirect(`${clientUrl}/login/user-pending-approve`); return; }
    if (userExist?.status === status.inactive) { res.status(400).redirect(`${clientUrl}/login/user-inactive`); return; }

    if (userExist?.status === status.active) {
      const token = await createToken({ id: String(userExist._id) }, 3);
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('u_tkn', token, isProd
        ? { httpOnly: true, secure: true, sameSite: 'none', domain: '.shadowclan.cl', path: '/', maxAge: 86_400_000 }
        : { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 86_400_000 }
      );
      res.status(200).redirect(appClientUrl);
    } else {
      res.status(400).redirect(`${clientUrl}/login/user-not-found`);
    }
  } catch (error) {
    console.error(error);
    res.status(500).redirect(`${clientUrl}/login/login-error`);
  }
});

export default router;
