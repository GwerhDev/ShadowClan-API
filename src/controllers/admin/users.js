const router = require('express').Router();
const { message } = require('../../messages');
const userSchema = require('../../models/User');
const characterSchema = require('../../models/Character');
const clanSchema = require('../../models/Clan');

router.get('/', async(req, res) => {
  try {
    const response = await userSchema.find();
    return res.json(response);    
  } catch (error) {
    return res.status(500).json(error);
  }
});

router.patch('/:id', async(req, res) => {
  try {
    const { id } = req.params;
    const { body } = req;

    await userSchema.findByIdAndUpdate(id, body);
    return res.status(200).send({ message: message.admin.updateuser.success });
  } catch (error) {
    return res.status(500).json({ message: message.admin.updateuser.error });
  }
});

router.delete('/:id', async(req, res) => {
  try {
    const { id } = req.params;
    const user = await userSchema.findById(id);
    if (!user) return res.status(404).json({ message: message.user.notfound });

    if (user.character?.length) {
      const charIds = user.character;
      await characterSchema.updateMany(
        { _id: { $in: charIds } },
        { status: 'unclaimed', clan: null }
      );
      await clanSchema.updateMany(
        {},
        { $pull: { member: { $in: charIds }, officer: { $in: charIds } } }
      );
    }

    await userSchema.findByIdAndDelete(id);
    return res.status(200).send({ message: message.admin.deleteuser.success });
  } catch (error) {
    return res.status(500).json({ message: message.admin.deleteuser.error });
  }
});

module.exports = router;