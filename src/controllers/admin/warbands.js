const router = require('express').Router();
const warbandSchema = require('../../models/Warband');
const { message } = require('../../messages');
const { decodeToken } = require('../../integrations/jwt');
const { roles } = require('../../misc/consts-user-model');

router.post('/create', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { name, leader } = req.body;
    const newWarband = new warbandSchema({ name, leader });

    await newWarband.save();
    return res.status(201).send(newWarband);
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;
    const { type, quantity, legendaryFound } = req.body;

    const updatedCrest = await warbandSchema.findOneAndUpdate(
      { _id: id, user: user._id },
      { type, quantity, legendaryFound },
      { new: true }
    );

    return res.status(200).send(updatedCrest);
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params;

    await warbandSchema.findOneAndDelete({ _id: id });

    return res.status(200).send({ message: message.crest.delete.success });
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

module.exports = router;