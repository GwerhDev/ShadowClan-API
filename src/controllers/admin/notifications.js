const router = require('express').Router();
const { decodeToken } = require('../../integrations/jwt');
const { message } = require('../../messages');
const { roles, status } = require('../../misc/consts-user-model');
const userSchema = require('../../models/User');

router.get('/', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) return res.status(403).json({ message: message.admin.permissionDenied });

    const decodedToken = await decodeToken(userToken);
    if (decodedToken?.data?.role !== roles.admin) return res.status(403).json({ message: message.admin.permissionDenied });

    const pendingUsers = await userSchema.find({
      status: status.pending,
    });

    const counter = pendingUsers.length;

    const response = {
      pendingUsers,
      counter
    };

    return res.json(response);
  } catch (error) {
    return res.status(500).json(error);
  } 
});

module.exports = router;