const router = require('express').Router();
const { decodeToken } = require('../../integrations/jwt');
const { message } = require('../../messages');
const { roles } = require('../../misc/consts-user-model');
const userSchema = require('../../models/User');

router.get('/', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const response = await userSchema.find();
    return res.json(response);    
  } catch (error) {
    return res.status(500).json(error);
  }
});

router.patch('/:id', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params || null;
    const { body } = req || null;
    await userSchema.findByIdAndUpdate(id, body);
    return res.status(200).send({ message: message.admin.updateuser.success });
  } catch (error) {
    return res.status(500).json({ message: message.admin.updateuser.error });
  }
});

router.delete('/:id', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const { id } = req.params || null;
    await userSchema.findByIdAndDelete(id);
    return res.status(200).send({ message: message.admin.deleteuser.success });
  } catch (error) {
    return res.status(500).json({ message: message.admin.deleteuser.error });
  }
});

module.exports = router;