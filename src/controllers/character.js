const router = require('express').Router();
const userSchema = require('../models/User');
const characterSchema = require('../models/Character');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

router.get('/', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);
    
    const user = await userSchema.findOne({ _id: decodedToken.data.id })?.populate("character");
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { character } = user;
    
    return res.status(200).send(character);
    
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.post('/create', async(req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);
    
    const user = await userSchema.findOne({ _id: decodedToken.data.id });
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { name, warband } = req.body;

    const newCharacter = await characterSchema.create({ name, warband });

    await userSchema.updateOne({ _id: user._id }, { $push: { character: newCharacter._id } });
    
    return res.status(200).send({ message: message.character.create.success });
    
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

module.exports = router;