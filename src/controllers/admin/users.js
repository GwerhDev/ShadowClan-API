const router = require('express').Router();
const { message } = require('../../messages');
const userSchema = require('../../models/User');

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
    const { id } = req.params || null;
    await userSchema.findByIdAndDelete(id);
    return res.status(200).send({ message: message.admin.deleteuser.success });
  } catch (error) {
    return res.status(500).json({ message: message.admin.deleteuser.error });
  }
});

module.exports = router;