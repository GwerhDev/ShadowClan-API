const router = require('express').Router();
const userSchema = require('../../models/User');
const characterSchema = require('../../models/Character');
const { message } = require('../../messages');
const { decodeToken } = require('../../integrations/jwt');

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

router.get('/', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const characters = await characterSchema.find();
    return res.status(200).send(characters);
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.post('/', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { character, resonance, currentClass } = req.body;
    const newCharacter = await characterSchema.create({ character, resonance, currentClass });
    return res.status(201).send({ message: message.member.create.success, character: newCharacter });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/:id', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { id } = req.params;
    const updatedCharacter = await characterSchema.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedCharacter) {
      return res.status(404).send({ message: message.member.notfound });
    }
    return res.status(200).send({ message: message.member.update.success, character: updatedCharacter });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.delete('/:id', authorizeRoles(['admin', 'leader', 'official']), async (req, res) => {
  try {
    const { id } = req.params;
    const deletedCharacter = await characterSchema.findByIdAndDelete(id);
    if (!deletedCharacter) {
      return res.status(404).send({ message: message.member.notfound });
    }
    return res.status(200).send({ message: message.member.delete.success });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

module.exports = router;