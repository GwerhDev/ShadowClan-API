import { Router, type Request, type Response } from 'express';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import { message } from '../../messages';

const router = Router();
const STATUS_ORDER: Record<string, number> = { claimed: 0, pending: 1, unclaimed: 2 };

async function getClansSorted(query: Record<string, unknown> = {}, { page = 1, limit = 50 } = {}) {
  const clans = await Clan.find(query).limit(limit).skip((page - 1) * limit).populate('leader').lean();
  return clans
    .sort((a, b) => (STATUS_ORDER[a.status ?? ''] ?? 3) - (STATUS_ORDER[b.status ?? ''] ?? 3))
    .map(clan => ({
      ...clan,
      totalMembers: (clan.leader ? 1 : 0) + (clan.officer?.length ?? 0) + (clan.member?.length ?? 0),
    }));
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page, limit } = req.query as { q?: string; page?: string; limit?: string };
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};
    res.status(200).json(await getClansSorted(query, { page: parseInt(page ?? '1', 10), limit: parseInt(limit ?? '50', 10) }));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    res.status(200).json(clan);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    await new Clan({ name }).save();
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { _id, leader, officer, member } = req.body as { _id?: string; leader?: string; officer?: string[]; member?: string[] };
    const prevClan    = await Clan.findById(_id).select('leader officer member');
    const updatedClan = await Clan.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updatedClan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const repairs: Promise<unknown>[] = [];
    const newLeader = leader ? String(leader) : null;
    if (newLeader && newLeader !== (prevClan?.leader ? String(prevClan.leader) : null)) {
      repairs.push(Character.findByIdAndUpdate(newLeader, { clan: _id }));
    }
    for (const charId of [...new Set([...(officer ?? []).map(String), ...(member ?? []).map(String)])]) {
      repairs.push(Character.findByIdAndUpdate(charId, { clan: _id }));
    }
    if (repairs.length) await Promise.allSettled(repairs);
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Clan.findByIdAndDelete(req.params.id);
    if (!deleted) { res.status(404).json({ message: 'Clan not found' }); return; }
    res.status(201).json(await getClansSorted());
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
