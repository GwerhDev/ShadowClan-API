const router = require('express').Router();
const taskSchema = require('../../models/Task');
const { message } = require('../../messages');

router.post("/", async (req, res) => {
  try {
    const { body } = req;
    const fixedTasks = await taskSchema.find({ type: body.type });

    return res.status(200).send(fixedTasks);

  } catch (error) {
    return res.status(500).send({ error: message.user.error })
  }
});

router.post("/create", async (req, res) => {
  try {
    const { body } = req;

    const newTask = new taskSchema(body);
    await newTask.save();

    return res.status(200).send(newTask);

  } catch (error) {
    return res.status(500).send({ error: message.user.error })
  }
});

module.exports = router;