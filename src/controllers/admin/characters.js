const router = require('express').Router();
const userSchema = require('../../models/User');
const characterSchema = require('../../models/Character');
const clanSchema = require('../../models/Clan');
const { message } = require('../../messages');
const { character } = require('../../misc/consts-models');

router.get('/', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    const query = q ? { name: { $regex: q, $options: 'i' } } : {};

    const characters = await characterSchema.find(query)
      .populate('clan', 'name')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    return res.status(200).send(characters);
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, resonance, currentClass } = req.body;
    if (!name) return res.status(400).send({ error: 'El nombre del personaje es obligatorio' });
    const newCharacter = await characterSchema.create({ name, resonance, currentClass });
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

router.patch('/:id/remove-clan', async (req, res) => {
  try {
    const { id } = req.params;
    const char = await characterSchema.findById(id).populate('clan', 'name');
    if (!char) return res.status(404).send({ message: message.member.notfound });

    const clanName = char.clan?.name ?? null;

    if (char.clan) {
      await clanSchema.updateOne(
        { _id: char.clan },
        { $pull: { member: char._id, officer: char._id } }
      );
    }

    const updated = await characterSchema.findByIdAndUpdate(
      id,
      { clan: null },
      { new: true }
    );

    if (clanName) {
      try {
        const { getIO } = require('../../socket');
        const owner = await userSchema.findOne({ character: id }).select('_id');
        if (owner) {
          getIO().to(`user:${owner._id}`).emit('clan:member-removed', { clanName, characterId: id });
        }
      } catch (e) {
        console.warn('Socket notification failed:', e.message);
      }
    }

    return res.status(200).send({ message: 'Personaje retirado del clan', character: updated });
  } catch (error) {
    return res.status(500).send({ error: message.member.error });
  }
});

router.patch('/:id/unclaim', async (req, res) => {
  try {
    const { id } = req.params;
    const char = await characterSchema.findById(id);
    if (!char) return res.status(404).send({ message: message.member.notfound });

    await userSchema.updateMany({ character: id }, { $pull: { character: id } });

    if (char.clan) {
      await clanSchema.updateOne(
        { _id: char.clan },
        { $pull: { member: char._id, officer: char._id } }
      );
    }

    const updated = await characterSchema.findByIdAndUpdate(
      id,
      { status: 'unclaimed', clan: null },
      { new: true }
    );

    return res.status(200).send({ message: 'Personaje desvinculado', character: updated });
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