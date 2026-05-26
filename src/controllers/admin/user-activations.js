const router = require('express').Router();
const User = require('../../models/User');
const { message } = require('../../messages');
const { status: userStatus } = require('../../misc/consts-user-model');

router.get('/', async (req, res) => {
  try {
    const users = await User.find({ status: userStatus.pending }).select('battletag role status createdAt');
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).json({ error: message.user.error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'activate' | 'reject'

    if (!['activate', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usa "activate" o "reject"' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (user.status !== userStatus.pending) {
      return res.status(409).json({ message: 'El usuario ya fue procesado' });
    }

    user.status = action === 'activate' ? userStatus.active : userStatus.inactive;
    await user.save();

    return res.status(200).json({
      message: action === 'activate' ? 'Usuario activado' : 'Usuario rechazado',
      user: { _id: user._id, battletag: user.battletag, status: user.status },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
