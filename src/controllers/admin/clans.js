const router = require('express').Router();
const Clan = require('../../models/Clan');
const { message } = require('../../messages');
const { decodeToken } = require('../../integrations/jwt');
const { roles } = require('../../misc/consts-user-model');

// GET all clans
router.get('/', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const clans = await Clan.find();
    return res.status(200).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET a single clan by ID
router.get('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

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
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { name, status, members } = req.body;
    const newClan = new Clan({ name, status, members });

    await newClan.save();

    const clans = await Clan.find();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH a clan by ID
router.patch('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    const updatedClan = await Clan.findByIdAndUpdate(id, req.body, { new: true });

    if (!updatedClan) {
      return res.status(404).json({ message: 'Clan not found' });
    }

    const clans = await Clan.find();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// DELETE a clan by ID
router.delete('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    const deletedClan = await Clan.findByIdAndDelete(id);

    if (!deletedClan) {
      return res.status(404).json({ message: 'Clan not found' });
    }
    const clans = await Clan.find();

    return res.status(201).json(clans);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
