const router = require('express').Router();
const Clan = require('../../models/Clan');
const { message } = require('../../messages');

const STATUS_ORDER = { claimed: 0, pending: 1, unclaimed: 2 };

async function getClansSorted(query = {}, { page = 1, limit = 50 } = {}) {
  const clans = await Clan.find(query)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .populate('leader')
    .lean();

  return clans
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3))
    .map(clan => ({
      ...clan,
      totalMembers: (clan.leader ? 1 : 0) + (clan.officer?.length ?? 0) + (clan.member?.length ?? 0),
    }));
}

// GET all clans
router.get('/', async (req, res) => {
  try {
    const { q, page = 1, limit = 50 } = req.query;
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};

    const clans = await getClansSorted(query, { page, limit });

    return res.status(200).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET a single clan by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const clan = await Clan.findById(id);

    if (!clan) {
      return res.status(404).json({ message: 'Clan not found' });
    }

    return res.status(200).json(clan);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST a new clan
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    const newClan = new Clan({ name });

    await newClan.save();

    const clans = await getClansSorted();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH a clan by ID
router.patch('/', async (req, res) => {
  try {
    const { _id } = req.body;
    const updatedClan = await Clan.findByIdAndUpdate(_id, req.body, { new: true });

    if (!updatedClan) {
      return res.status(404).json({ message: 'Clan not found' });
    }

    const clans = await getClansSorted();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// DELETE a clan by ID
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedClan = await Clan.findByIdAndDelete(id);

    if (!deletedClan) {
      return res.status(404).json({ message: 'Clan not found' });
    }

    const clans = await getClansSorted();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
