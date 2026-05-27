const router = require('express').Router();
const User      = require('../../models/User');
const Clan      = require('../../models/Clan');
const Character = require('../../models/Character');
const ClanRequest = require('../../models/ClanRequest');

// Map stored class values → display names
const CLASS_LABELS = {
  druid:        'Druida',
  barbarian:    'Bárbaro',
  bloodknight:  'C. de Sangre',
  crusader:     'G. Divino',
  demonhunter:  'C. de Demonios',
  monk:         'Monje',
  necromancer:  'Nigromante',
  tempest:      'Tempest',
  wizard:       'Arcanista',
};

router.get('/growth', async (req, res) => {
  try {
    const range = req.query.range ?? '30';
    const users = await User.find({ createdAt: { $exists: true } }).select('createdAt').lean();
    const now   = new Date();
    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    let labels = [];
    let counts = [];

    if (range === 'all') {
      if (!users.length) return res.json({ labels: [], counts: [] });

      const earliest = users.reduce((min, u) => {
        const d = new Date(u.createdAt);
        return d < min ? d : min;
      }, now);

      let cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
      const end  = new Date(now.getFullYear(), now.getMonth(), 1);

      while (cursor <= end) {
        const y = cursor.getFullYear(), m = cursor.getMonth();
        labels.push(`${MONTHS[m]} ${y}`);
        counts.push(users.filter(u => {
          const d = new Date(u.createdAt);
          return d.getFullYear() === y && d.getMonth() === m;
        }).length);
        cursor = new Date(y, m + 1, 1);
      }

    } else {
      const days = parseInt(range);

      if (days <= 30) {
        // By day
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
          counts.push(users.filter(u => {
            const c = new Date(u.createdAt);
            return c.getFullYear() === d.getFullYear() &&
                   c.getMonth()    === d.getMonth()    &&
                   c.getDate()     === d.getDate();
          }).length);
        }
      } else {
        // By week
        const weeks = Math.ceil(days / 7);
        for (let i = weeks - 1; i >= 0; i--) {
          const weekEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
          const weekStart = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 6);
          labels.push(`${weekStart.getDate()}/${weekStart.getMonth() + 1}`);
          counts.push(users.filter(u => {
            const c = new Date(u.createdAt);
            return c >= weekStart && c <= weekEnd;
          }).length);
        }
      }
    }

    return res.json({ labels, counts });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener datos de crecimiento' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [users, clans, characters, clanRequests] = await Promise.all([
      User.find().lean(),
      Clan.find().populate('leader', 'name').lean(),
      Character.find().lean(),
      ClanRequest.find().lean(),
    ]);

    // Role distribution
    const roleDistribution = { walker: 0, user: 0, leader: 0, officer: 0, admin: 0, super_admin: 0 };
    for (const u of users) {
      if (roleDistribution[u.role] !== undefined) roleDistribution[u.role]++;
    }

    // User status
    const activeUsers   = users.filter(u => u.status === 'active').length;
    const pendingUsers  = users.filter(u => u.status === 'pending').length;
    const inactiveUsers = users.filter(u => u.status === 'inactive').length;

    // Characters
    const claimedChars = characters.filter(c => c.status === 'claimed');
    const walkers      = claimedChars.filter(c => !c.clan).length;

    // Characters by class (ordered, using display labels)
    const classCounts = {};
    for (const c of characters) {
      if (c.currentClass) {
        const label = CLASS_LABELS[c.currentClass] ?? c.currentClass;
        classCounts[label] = (classCounts[label] || 0) + 1;
      }
    }
    // Preserve canonical order
    const classOrder = Object.values(CLASS_LABELS);
    const charactersByClass = classOrder.map(label => ({
      label,
      count: classCounts[label] || 0,
    }));

    // Clan requests
    const pendingReqs  = clanRequests.filter(r => r.status === 'pending').length;
    const acceptedReqs = clanRequests.filter(r => r.status === 'accepted').length;
    const rejectedReqs = clanRequests.filter(r => r.status === 'rejected').length;

    const claimedClans = clans.filter(c => c.status === 'claimed');
    const clanList = claimedClans.map(c => ({
      _id:         String(c._id),
      name:        c.name,
      leader:      c.leader?.name ?? null,
      memberCount: (c.member?.length ?? 0) + (c.officer?.length ?? 0) + (c.leader ? 1 : 0),
    }));

    // Crecimiento de usuarios — últimos 6 meses
    const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const now = new Date();
    const growthLabels = [];
    const growthCounts = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      growthLabels.push(MONTH_NAMES[d.getMonth()]);
      const count = users.filter(u => {
        if (!u.createdAt) return false;
        const c = new Date(u.createdAt);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
      }).length;
      growthCounts.push(count);
    }

    return res.json({
      totalUsers:      users.length,
      totalClans:      claimedClans.length,
      totalCharacters: claimedChars.length,
      walkers,
      activeUsers,
      pendingUsers,
      inactiveUsers,
      roleDistribution,
      clanRequests: { pending: pendingReqs, accepted: acceptedReqs, rejected: rejectedReqs },
      charactersByClass,
      clans: clanList,
      userGrowth: { labels: growthLabels, counts: growthCounts },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener estadísticas de overview' });
  }
});

module.exports = router;
