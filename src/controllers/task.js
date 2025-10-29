const router = require('express').Router();
const userSchema = require('../models/User');
const taskSchema = require('../models/Task');
const completedTaskSchema = require('../models/CompletedTask');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

router.post("/", async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);

    const user = await userSchema.findOne({ _id: decodedToken.data.id });
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { date, type, character } = req.body || null;

    if (!character) {
      const response = [
        ...await taskSchema.find({ fixed: true, type }),
        ...await taskSchema.find({ date: new Date(date), user: user._id, type })
      ];

      const completedTaskDate = await completedTaskSchema.find({ user: user._id, date: new Date(date), type });
      const formattedResponse = response.map(task => {
        const { _id, title, date, fixed } = task;

        const completedTaskExist = completedTaskDate.find(t => t.task.includes(_id));
        const completed = completedTaskExist ? true : false;

        return { _id, title, date, fixed, completed };
      });

      return res.status(200).send(formattedResponse);
    };

    const response = [
      ...await taskSchema.find({ fixed: true, type }),
      ...await taskSchema.find({ date: new Date(date), character: character, type })
    ];

    const completedTaskDate = await completedTaskSchema.find({ character: character, date: new Date(date), type });

    const formattedResponse = response.map(task => {
      const { _id, title, date, fixed } = task;

      const completedTaskExist = completedTaskDate.find(t => t.task.includes(_id));
      const completed = completedTaskExist ? true : false;

      return { _id, title, date, fixed, completed };
    });

    return res.status(200).send(formattedResponse);

  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.post("/create", async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);

    const user = await userSchema.findOne({ _id: decodedToken.data.id });
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { body } = req || null;

    const newTask = new taskSchema(body);

    await newTask.save();

    return res.status(200).send({ message: message.task.created });

  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

router.patch("/update/:id", async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);

    const user = await userSchema.findOne({ _id: decodedToken.data.id });
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { id } = req.params || null;
    const { body } = req || null;

    await taskSchema.findByIdAndUpdate(id, body);

    return res.status(200).send({ message: message.task.updated });

  } catch (error) {
    return res.status(500).send({ error: message.user.error })
  }
});

router.delete("/delete/:id", async (req, res) => {
  try {
    const userToken = req.headers.authorization;
    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findOne({ _id: decodedToken.data.id });

    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });

    const { id } = req.params || null;

    await taskSchema.deleteOne({ _id: id });
    await completedTaskSchema.updateMany({ task: id }, { $pull: { task: id } });

    return res.status(200).send({ message: message.task.deleted });

  } catch (error) {
    return res.status(500).send({ error: message.user.error })
  }
});

module.exports = router;