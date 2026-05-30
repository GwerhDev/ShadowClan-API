import { Router, type Request, type Response } from 'express';
import passport from 'passport';
import User from '../models/User';
import { signupBnet } from '../integrations/bnet';
import { clientUrl } from '../config';
import { roles, status } from '../misc/consts-user-model';

passport.use('signup-bnet', signupBnet as Parameters<typeof passport.use>[1]);

const router = Router();

router.get('/', passport.authenticate('signup-bnet'));

router.get('/callback', passport.authenticate('signup-bnet', {
  successRedirect: '/signup-bnet/success',
  failureRedirect: '/signup-bnet/failure',
}));

router.get('/failure', (_req: Request, res: Response): void => {
  res.status(400).redirect(`${clientUrl}/signup/register-error`);
});

router.get('/success', async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionUser = ((req.session as unknown) as { passport?: { user?: { battlenetId?: string; battletag?: string; provider?: string } } }).passport?.user;
    if (!sessionUser?.battlenetId) { res.status(400).redirect(`${clientUrl}/signup/register-error`); return; }

    const exists = await User.findOne({ battlenetId: sessionUser.battlenetId });
    if (exists) { res.status(400).redirect(`${clientUrl}/signup/already-registered`); return; }

    const newUser = new User({
      battlenetId: sessionUser.battlenetId,
      battletag:   sessionUser.battletag,
      provider:    sessionUser.provider,
      status:      status.pending,
      role:        roles.user,
    });
    await newUser.save();

    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
      for (const admin of admins) {
        io.to(`dashboard:${String(admin._id)}`).emit('admin:request:new', {
          type: 'user-activation', id: String(newUser._id),
          user: { battletag: newUser.battletag }, createdAt: newUser.createdAt,
        });
        io.to(`dashboard:${String(admin._id)}`).emit('admin:user:registered', {
          id: String(newUser._id), battletag: newUser.battletag,
          status: newUser.status, role: newUser.role, createdAt: newUser.createdAt,
        });
      }
    } catch (e) {
      console.warn('Socket notification failed:', (e as Error).message);
    }

    res.status(200).redirect(`${clientUrl}/signup/register-success`);
  } catch (error) {
    console.error(error);
    res.status(500).redirect(`${clientUrl}/signup/register-error`);
  }
});

export default router;
