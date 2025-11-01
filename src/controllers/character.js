const router = require('express').Router();
const userSchema = require('../models/User');
const characterSchema = require('../models/Character');
const { message } = require('../messages');
const { decodeToken } = require('../integrations/jwt');

router.get('/', async (req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    const decodedToken = await decodeToken(userToken);

    const user = await userSchema.findById(decodedToken.data.id)
      .populate("character")
      .populate({ path: 'character', populate: { path: 'clan' } })
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { character } = user;

    return res.status(200).send(character);

  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.post('/create', async (req, res) => {
  try {
    const bearer = req.headers.authorization?.split(' ')[1];
    const userToken = req.cookies['u_tkn'] || bearer;
    if (!userToken) return res.status(401).send({ error: 'Missing token' });

    let decodedToken;
    try {
      decodedToken = await decodeToken(userToken);
    } catch {
      return res.status(401).send({ error: 'Invalid token' });
    }

    const user = await userSchema.findById(decodedToken.data.id);
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { name, currentClass, resonance, clan } = req.body || {};
    if (!name) return res.status(400).send({ error: 'name is required' });

    const characterExists = await characterSchema.findOne({ name });

    if (characterExists?.claimed) {
      return res.status(409).send({ error: 'Character already claimed' });
    }

    if (characterExists && !characterExists.claimed) {
      return res.status(409).send({
        error: 'Character already exists, but not claimed',
        characterId: characterExists._id
      });
    }

    const newCharacter = await characterSchema.create({
      name, currentClass, resonance, clan, claimed: true,
    });

    await userSchema.updateOne(
      { _id: user._id },
      { $push: { character: newCharacter._id } }
    );

    const updatedUser = await userSchema.findById(user._id).populate('character');
    if (!updatedUser) return res.status(404).send({ logged: false, message: message.user.notfound });

    return res.status(201).send({
      message: message.character.create.success,
      character: newCharacter,
      user: updatedUser
    });

  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).send({ error: 'Character name already taken' });
    }
    console.error(error);
    return res.status(500).send({ error: message.user.error });
  }
});

module.exports = router;
