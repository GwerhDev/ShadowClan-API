import { Router, type Request, type Response } from 'express';
import User from '../../models/User';
import Character from '../../models/Character';
import Clan from '../../models/Clan';
import { message } from '../../messages';
import { characterConsts } from '../../misc/consts-models';
import { calcScore } from '../../helpers/score';
import { closeMembership } from '../../helpers/clanMembership';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page, limit, ids } = req.query as { q?: string; page?: string; limit?: string; ids?: string };
    const pageNum  = Math.max(1, parseInt(page  ?? '1',  10));
    const idsArr   = ids?.trim() ? ids.split(',').map((id) => id.trim()).filter(Boolean) : null;
    const limitNum = idsArr ? Math.min(100, Math.max(1, idsArr.length)) : Math.min(100, Math.max(1, parseInt(limit ?? '30', 10)));
    const query = idsArr
      ? { _id: { $in: idsArr } }
      : q?.trim() ? { name: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const [chars, total] = await Promise.all([
      Character.find(query).populate('clan', 'name').sort({ name: 1 })
        .limit(limitNum).skip(idsArr ? 0 : (pageNum - 1) * limitNum).lean(),
      Character.countDocuments(query),
    ]);
    res.status(200).json({ data: chars, total, page: pageNum, limit: limitNum, hasMore: idsArr ? false : pageNum * limitNum < total });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, resonance, currentClass } = req.body as { name?: string; resonance?: number; currentClass?: string };
    if (!name) { res.status(400).json({ error: 'El nombre del personaje es obligatorio' }); return; }
    const char = await Character.create({ name, resonance, currentClass });
    res.status(201).json({ message: message.character.create.success, character: char });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { _id } = req.body as { _id?: string };
    const existing = await Character.findById(_id);
    if (!existing) { res.status(404).json({ message: message.member.notfound }); return; }
    req.body.score = calcScore({
      resonance:        req.body.resonance        ?? existing.resonance        ?? 0,
      armor:            req.body.armor            ?? existing.armor            ?? 0,
      armorPenetration: req.body.armorPenetration ?? existing.armorPenetration ?? 0,
      power:            req.body.power            ?? existing.power            ?? 0,
      resistance:       req.body.resistance       ?? existing.resistance       ?? 0,
    });
    const updated = await Character.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updated) { res.status(404).json({ message: message.member.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/claim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, characterId } = req.body as { userId?: string; characterId?: string };
    const updChar = await Character.findByIdAndUpdate(characterId, { status: characterConsts.status.claimed }, { new: true });
    if (!updChar) { res.status(404).json({ message: message.member.notfound }); return; }
    const updUser = await User.findByIdAndUpdate(userId, { $push: { character: characterId } }, { new: true });
    if (!updUser) { res.status(404).json({ message: message.user.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find(), users: await User.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/unclaim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, characterId } = req.body as { userId?: string; characterId?: string };
    const updChar = await Character.findByIdAndUpdate(characterId, { status: characterConsts.status.unclaimed }, { new: true });
    if (!updChar) { res.status(404).json({ message: message.member.notfound }); return; }
    const updUser = await User.findByIdAndUpdate(userId, { $pull: { character: characterId } }, { new: true });
    if (!updUser) { res.status(404).json({ message: message.user.notfound }); return; }
    res.status(200).json({ message: message.character.update.success, characters: await Character.find(), users: await User.find() });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/:id/remove-clan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const char = await Character.findById(id).populate('clan', 'name');
    if (!char) { res.status(404).json({ message: message.member.notfound }); return; }
    const clanDoc = char.clan as unknown as { _id?: unknown; name?: string } | undefined;
    const clanName = clanDoc?.name ?? null;
    if (clanDoc?._id) {
      await Clan.updateOne({ _id: clanDoc._id }, { $pull: { member: char._id, officer: char._id } });
      await closeMembership(char._id, clanDoc._id as string, { removedBy: req.user!._id });
    }
    const updated = await Character.findByIdAndUpdate(id, { clan: null }, { new: true });
    if (clanName) {
      try {
        const { getIO } = await import('../../socket');
        const owner = await User.findOne({ character: id }).select('_id');
        if (owner) getIO().to(`user:${String(owner._id)}`).emit('clan:member-removed', { clanName, characterId: id });
      } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    }
    res.status(200).json({ message: 'Personaje retirado del clan', character: updated });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.patch('/:id/unclaim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const char = await Character.findById(id);
    if (!char) { res.status(404).json({ message: message.member.notfound }); return; }
    await User.updateMany({ character: id }, { $pull: { character: id } });
    if (char.clan) {
      await Clan.updateOne({ _id: char.clan }, { $pull: { member: char._id, officer: char._id } });
      await closeMembership(char._id, char.clan, { removedBy: req.user!._id });
    }
    const updated = await Character.findByIdAndUpdate(id, { status: 'unclaimed', clan: null }, { new: true });
    res.status(200).json({ message: 'Personaje desvinculado', character: updated });
  } catch { res.status(500).json({ error: message.member.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const char = await Character.findById(req.params.id);
    if (!char) { res.status(404).json({ message: message.member.notfound }); return; }
    // Borrar el personaje no debe dejar referencias colgantes en el clan (roster,
    // exmiembros) — se limpia el clan y se cierra la membresía abierta, si había una,
    // antes de borrar el documento.
    if (char.clan) {
      await Clan.updateOne({ _id: char.clan }, { $pull: { member: char._id, officer: char._id } });
      await closeMembership(char._id, char.clan, { removedBy: req.user!._id });
    }
    await Character.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: message.character.delete.success });
  } catch { res.status(500).json({ error: message.member.error }); }
});

export default router;
