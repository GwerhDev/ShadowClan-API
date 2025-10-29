const router = require('express').Router();
const Member = require('../../models/Member');
const userSchema = require('../../models/User');
const { message } = require('../../messages');
const { decodeToken } = require('../../integrations/jwt');

const authorizeRoles = (allowedRoles) => async (req, res, next) => {
  try {
    const userToken = req.headers.authorization;
    if (!userToken) {
      return res.status(401).send({ message: message.admin.permissionDenied });
    }

    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findOne({ _id: decodedToken.data.id });

    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).send({ message: message.admin.permissionDenied });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
};

router.get('/', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const members = await Member.find();
    return res.status(200).send(members);
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.post('/', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { character, resonance, class: memberClass, whatsapp } = req.body;
    const newMember = await Member.create({ character, resonance, class: memberClass, whatsapp });
    return res.status(201).send({ message: message.member.create.success, member: newMember });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/:id', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { id } = req.params;
    const updatedMember = await Member.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedMember) {
      return res.status(404).send({ message: message.member.notfound });
    }
    return res.status(200).send({ message: message.member.update.success, member: updatedMember });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.delete('/:id', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { id } = req.params;
    const deletedMember = await Member.findByIdAndDelete(id);
    if (!deletedMember) {
      return res.status(404).send({ message: message.member.notfound });
    }
    return res.status(200).send({ message: message.member.delete.success });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

module.exports = router;