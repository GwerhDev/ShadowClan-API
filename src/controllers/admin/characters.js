const router = require('express').Router();
const userSchema = require('../../models/User');
const characterSchema = require('../../models/Character');
const { message } = require('../../messages');
const { character } = require('../../misc/consts-models');

router.get('/', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};

    const characters = await characterSchema.find(query)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    return res.status(200).send(characters);
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.post('/', async (req, res) => {
  try {
    const { character, resonance, currentClass } = req.body;
    const newCharacter = await characterSchema.create({ character, resonance, currentClass });
    return res.status(201).send({ message: message.member.create.success, character: newCharacter });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/', async (req, res) => {
  try {
    const { _id } = req.body;
    const updatedCharacter = await characterSchema.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updatedCharacter) {
      return res.status(404).send({ message: message.member.notfound });
    }
    const characters = await characterSchema.find();

    return res.status(200).send({ message: message.member.update.success, characters });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/claim', async (req, res) => {
  try {
    const { userId, characterId } = req.body;

    const updatedCharacter = await characterSchema.findByIdAndUpdate(characterId, { status: character.status.claimed }, { new: true });
    if (!updatedCharacter) return res.status(404).send({ message: message.member.notfound });

    const updatedUser = await userSchema.findByIdAndUpdate(userId, { $push: { character: characterId } }, { new: true });
    if (!updatedUser) return res.status(404).send({ logged: false, message: message.user.notfound });

    const characters = await characterSchema.find();
    const users = await userSchema.find();

    return res.status(200).send({ message: message.member.update.success, characters, users });

  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/unclaim', async (req, res) => {
  try {
    const { userId, characterId } = req.body;
    
    const updatedCharacter = await characterSchema.findByIdAndUpdate(characterId, { status: character.status.unclaimed }, { new: true });
    if (!updatedCharacter) return res.status(404).send({ message: message.member.notfound });

    const updatedUser = await userSchema.findByIdAndUpdate(userId, { $pull: { character: characterId } }, { new: true });
    if (!updatedUser) return res.status(404).send({ logged: false, message: message.user.notfound });

    const characters = await characterSchema.find();
    const users = await userSchema.find();

    return res.status(200).send({ message: message.member.update.success, characters, users });

  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.delete('/:id', async (req, res) => {
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