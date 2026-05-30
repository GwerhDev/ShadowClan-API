import { Router, type Request, type Response } from 'express';
import User        from '../../models/User';
import Clan        from '../../models/Clan';
import Character   from '../../models/Character';
import ClanRequest from '../../models/ClanRequest';

const router = Router();

const CLASS_LABELS: Record<string, string> = {
  druid: 'Druida', barbarian: 'Bárbaro', bloodknight: 'C. de Sangre',
  crusader: 'G. Divino', demonhunter: 'C. de Demonios', monk: 'Monje',
  necromancer: 'Nigromante', tempest: 'Tempest', wizard: 'Arcanista',
};

router.get('/growth', async (req: Request, res: Response): Promise<void> => {
  try {
    const range = (req.query.range as string) ?? '30';
    const users = await User.find({ createdAt: { $exists: true } }).select('createdAt').lean();
    const now   = new Date();
    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const labels: string[] = [], counts: number[] = [];

    if (range === 'all') {
      if (!users.length) { res.json({ labels: [], counts: [] }); return; }
      const earliest = users.reduce((min, u) => { const d = new Date((u as {createdAt?: Date}).createdAt!); return d < min ? d : min; }, now);
      let cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
      const end  = new Date(now.getFullYear(), now.getMonth(), 1);
      while (cursor <= end) {
        const y = cursor.getFullYear(), m = cursor.getMonth();
        labels.push(`${MONTHS[m]} ${y}`);
        counts.push(users.filter(u => { const d = new Date((u as {createdAt?: Date}).createdAt!); return d.getFullYear() === y && d.getMonth() === m; }).length);
        cursor = new Date(y, m + 1, 1);
      }
    } else {
      const days = parseInt(range, 10);
      if (days <= 30) {
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
          counts.push(users.filter(u => { const c = new Date((u as {createdAt?: Date}).createdAt!); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && c.getDate() === d.getDate(); }).length);
        }
      } else {
        const weeks = Math.ceil(days / 7);
        for (let i = weeks - 1; i >= 0; i--) {
          const weekEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
          const weekStart = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 6);
          labels.push(`${weekStart.getDate()}/${weekStart.getMonth() + 1}`);
          counts.push(users.filter(u => { const c = new Date((u as {createdAt?: Date}).createdAt!); return c >= weekStart && c <= weekEnd; }).length);
        }
      }
    }
    res.json({ labels, counts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener datos de crecimiento' });
  }
});

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [users, clans, characters, clanRequests] = await Promise.all([
      User.find().lean(),
      Clan.find().populate('leader', 'name').lean(),
      Character.find().lean(),
      ClanRequest.find().lean(),
    ]);

    type UserLean = { role?: string; status?: string; createdAt?: Date };
    type CharLean = { status?: string; clan?: unknown; currentClass?: string };
    type ClanLean = { status?: string; name?: string; leader?: { name?: string } | null; member?: unknown[]; officer?: unknown[] };
    type ReqLean  = { status?: string };

    const roleDistribution: Record<string, number> = { walker: 0, user: 0, leader: 0, officer: 0, admin: 0, super_admin: 0 };
    for (const u of users as UserLean[]) { if (u.role && roleDistribution[u.role] !== undefined) roleDistribution[u.role]++; }

    const us = users as UserLean[];
    const activeUsers   = us.filter(u => u.status === 'active').length;
    const pendingUsers  = us.filter(u => u.status === 'pending').length;
    const inactiveUsers = us.filter(u => u.status === 'inactive').length;

    const cs = characters as CharLean[];
    const claimedChars = cs.filter(c => c.status === 'claimed');
    const walkers      = claimedChars.filter(c => !c.clan).length;

    const classCounts: Record<string, number> = {};
    for (const c of cs) { if (c.currentClass) { const lbl = CLASS_LABELS[c.currentClass] ?? c.currentClass; classCounts[lbl] = (classCounts[lbl] || 0) + 1; } }
    const charactersByClass = Object.values(CLASS_LABELS).map(label => ({ label, count: classCounts[label] || 0 }));

    const rs = clanRequests as ReqLean[];
    const pendingReqs  = rs.filter(r => r.status === 'pending').length;
    const acceptedReqs = rs.filter(r => r.status === 'accepted').length;
    const rejectedReqs = rs.filter(r => r.status === 'rejected').length;

    const cl = clans as ClanLean[];
    const claimedClans = cl.filter(c => c.status === 'claimed');
    const clanList = claimedClans.map(c => ({ _id: String((c as {_id?: unknown})._id), name: c.name, leader: c.leader?.name ?? null, memberCount: (c.member?.length ?? 0) + (c.officer?.length ?? 0) + (c.leader ? 1 : 0) }));

    const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const now = new Date();
    const growthLabels: string[] = [], growthCounts: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      growthLabels.push(MONTH_NAMES[d.getMonth()]);
      growthCounts.push(us.filter(u => { if (!u.createdAt) return false; const c = new Date(u.createdAt); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); }).length);
    }

    res.json({ totalUsers: users.length, totalClans: claimedClans.length, totalCharacters: claimedChars.length, walkers, activeUsers, pendingUsers, inactiveUsers, roleDistribution, clanRequests: { pending: pendingReqs, accepted: acceptedReqs, rejected: rejectedReqs }, charactersByClass, clans: clanList, userGrowth: { labels: growthLabels, counts: growthCounts } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener estadísticas de overview' });
  }
});

export default router;
