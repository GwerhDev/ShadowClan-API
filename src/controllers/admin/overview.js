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

router.get('/', async (req, res) => {
  try {
    const [users, totalClans, characters, clanRequests] = await Promise.all([
      User.find().lean(),
      Clan.countDocuments(),
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

    return res.json({
      totalUsers:      users.length,
      totalClans,
      totalCharacters: claimedChars.length,
      walkers,
      activeUsers,
      pendingUsers,
      inactiveUsers,
      roleDistribution,
      clanRequests: { pending: pendingReqs, accepted: acceptedReqs, rejected: rejectedReqs },
      charactersByClass,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener estadísticas de overview' });
  }
});

module.exports = router;
