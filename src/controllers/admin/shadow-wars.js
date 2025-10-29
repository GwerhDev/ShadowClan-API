const router = require('express').Router();
const ShadowWar = require('../../models/ShadowWar');
const { message } = require('../../messages');
const { decodeToken } = require('../../integrations/jwt');
const { roles } = require('../../misc/consts-user-model');

// GET all shadow wars
router.get('/', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalShadowWars = await ShadowWar.countDocuments();
    const shadowWars = await ShadowWar.find()
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('enemyClan')

    return res.status(200).json({
      total: totalShadowWars,
      page,
      limit,
      pages: Math.ceil(totalShadowWars / limit),
      data: shadowWars
    });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET a single shadow war by ID
router.get('/by-date', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { date } = req.query;
    const searchDate = new Date(date);

    const startOfDay = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate());
    const endOfDay = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate() + 1);

    const shadowWar = await ShadowWar.findOne({ date: { $gte: startOfDay, $lt: endOfDay } })
      .populate('enemyClan')
      .populate('confirmed')
      .populate('battle.exalted.group1.member')
      .populate('battle.exalted.group2.member')
      .populate('battle.eminent.group1.member')
      .populate('battle.eminent.group2.member')
      .populate('battle.famed.group1.member')
      .populate('battle.famed.group2.member')
      .populate('battle.proud.group1.member')
      .populate('battle.proud.group2.member');

    if (!shadowWar) {
      return res.status(404).json({ message: 'Shadow War not found' });
    }

    return res.status(200).json(shadowWar);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// GET a single shadow war by ID
router.get('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    const shadowWar = await ShadowWar.findById(id)
      .populate('enemyClan')
      .populate('confirmed')
      .populate('battle.exalted.group1.member')
      .populate('battle.exalted.group2.member')
      .populate('battle.eminent.group1.member')
      .populate('battle.eminent.group2.member')
      .populate('battle.famed.group1.member')
      .populate('battle.famed.group2.member')
      .populate('battle.proud.group1.member')
      .populate('battle.proud.group2.member')

    if (!shadowWar) {
      return res.status(404).json({ message: 'Shadow War not found' });
    }

    return res.status(200).json(shadowWar);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// POST a new shadow war
router.post('/', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const newShadowWar = new ShadowWar(req.body);

    await newShadowWar.save();
    return res.status(201).json(newShadowWar);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH a shadow war by ID
router.patch('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    let shadowWar = await ShadowWar.findById(id)
      .populate('enemyClan')
      .populate('confirmed')
      .populate('battle.exalted.group1.member')
      .populate('battle.exalted.group2.member')
      .populate('battle.eminent.group1.member')
      .populate('battle.eminent.group2.member')
      .populate('battle.famed.group1.member')
      .populate('battle.famed.group2.member')
      .populate('battle.proud.group1.member')
      .populate('battle.proud.group2.member');

    if (!shadowWar) {
      return res.status(404).json({ message: 'Shadow War not found' });
    }

    if (req.body.enemyClan === '') {
      req.body.enemyClan = null; // Convert empty string to null for ObjectId
    }

    Object.assign(shadowWar, req.body);

    const updatedShadowWar = await shadowWar.save(); // Save triggers validation and proper subdocument handling

    return res.status(200).json(updatedShadowWar);
  } catch (error) {
    console.error("Error updating Shadow War:", error);
    return res.status(500).json({ error: message.user.error, details: error.message });
  }
});

// DELETE a shadow war by ID
router.delete('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    const deletedShadowWar = await ShadowWar.findByIdAndDelete(id);

    if (!deletedShadowWar) {
      return res.status(404).json({ message: 'Shadow War not found' });
    }

    return res.status(200).json({ message: 'Shadow War deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
