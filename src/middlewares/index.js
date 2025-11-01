const userSchema = require('../models/User');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

const authorizeRoles = (allowedRoles) => async (req, res, next) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    if (!userToken) {
      return res.status(401).send({ message: message.admin.permissionDenied });
    }

    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findById(decodedToken.data.id);

    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).send({ message: message.admin.permissionDenied });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
};

module.exports = { authorizeRoles };