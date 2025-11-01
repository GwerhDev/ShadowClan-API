const router = require('express').Router();
const userSchema = require('../../models/User');
const characterSchema = require('../../models/Character');
const { message } = require('../../messages');

router.get('/', async (req, res) => {
  try {
    const characters = await characterSchema.find();
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

router.patch('/:id', async (req, res) => {
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

router.patch('/:user_id/claim/:character_id', async (req, res) => {
  try {
    const { user_id, character_id } = req.params;
    const updatedCharacter = await characterSchema.findByIdAndUpdate(character_id, { claimed: true }, { new: true });
    if (!updatedCharacter) {
      return res.status(404).send({ message: message.member.notfound });
    }
    const updatedUser = await userSchema.findByIdAndUpdate(user_id, { $push: { characters: character_id } }, { new: true });

    return res.status(200).send({ message: message.member.update.success, character: updatedCharacter, user: updatedUser });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/:user_id/unclaim/:character_id', async (req, res) => {
  try {
    const { user_id, character_id } = req.params;
    const updatedCharacter = await characterSchema.findByIdAndUpdate(character_id, { claimed: false }, { new: true });
    if (!updatedCharacter) {
      return res.status(404).send({ message: message.member.notfound });
    }
    const updatedUser = await userSchema.findByIdAndUpdate(user_id, { $pull: { characters: character_id } }, { new: true });

    return res.status(200).send({ message: message.member.update.success, character: updatedCharacter, user: updatedUser });
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