import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import Character from '../../models/Character';
import Clan from '../../models/Clan';
import { message } from '../../messages';
import { roles, status } from '../../misc/consts-user-model';
import { closeMembership } from '../../helpers/clanMembership';
import { handleError } from '../../helpers/http';

const VALID_ROLES    = Object.values(roles);
const VALID_STATUSES = Object.values(status);

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    const pageNum  = Math.max(1, parseInt(page  ?? '1',  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10)));
    const filter   = q?.trim() ? { battletag: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).limit(limitNum).skip((pageNum - 1) * limitNum).lean(),
      User.countDocuments(filter),
    ]);
    res.status(200).json({ data: users, total, page: pageNum, limit: limitNum, hasMore: pageNum * limitNum < total });
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, status: userStatus, character, phone } = req.body as { role?: string; status?: string; character?: string[]; phone?: string };
    const update: Record<string, unknown> = {};
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) { res.status(400).json({ message: 'Rol inválido.' }); return; }
      update.role = role;
    }
    if (userStatus !== undefined) {
      if (!VALID_STATUSES.includes(userStatus as typeof VALID_STATUSES[number])) { res.status(400).json({ message: 'Estado inválido.' }); return; }
      update.status = userStatus;
    }
    if (character !== undefined) {
      if (!Array.isArray(character)) { res.status(400).json({ message: 'character debe ser un arreglo.' }); return; }
      update.character = character.map(c => String((c as { _id?: unknown })?._id ?? c));
    }
    if (phone !== undefined) update.phone = String(phone);
    // Un super_admin no puede quitarse su propio rol ni desactivarse (evita quedar sin acceso).
    if (String(req.params.id) === String(req.user!._id) && (('role' in update && update.role !== req.user!.role) || ('status' in update && update.status !== 'active'))) {
      res.status(400).json({ message: 'No puedes cambiar tu propio rol o estado.' }); return;
    }
    const updated = await User.findByIdAndUpdate(req.params.id, update);
    if (!updated) { res.status(404).json({ message: message.user.notfound }); return; }
    res.status(200).json({ message: message.admin.updateuser });
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: message.user.notfound }); return; }

    if (String(user._id) === String(req.user!._id)) { res.status(400).json({ message: 'No puedes eliminar tu propia cuenta desde aquí.' }); return; }

    if (user.character.length) {
      // Cerrar membresías abiertas antes de desvincular (historial de exmiembros).
      const chars = await Character.find({ _id: { $in: user.character } }).select('clan');
      await Promise.all(chars.filter(c => c.clan).map(c => closeMembership(c._id, c.clan!, { removedBy: req.user!._id })));
      await Character.updateMany({ _id: { $in: user.character } }, { status: 'unclaimed', clan: null });
      await Clan.updateMany({}, { $pull: { member: { $in: user.character }, officer: { $in: user.character } } });
      await Clan.updateMany({ leader: { $in: user.character } }, { $unset: { leader: '' } });
    }

    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: message.admin.deleteuser });
  } catch (err) { handleError(res, err); }
});

export default router;
