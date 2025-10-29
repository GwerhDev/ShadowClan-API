const router = require('express').Router();
const clans = require('./clans');
const users = require('./users');
const member = require('./members');
const warbands = require('./warbands');
const shadowWars = require('./shadow-wars');
const fixedTasks = require('./fixed-tasks');
const notifications = require('./notifications');

router.use("/users", users);
router.use("/clans", clans);
router.use("/members", member);
router.use("/warbands", warbands);
router.use("/shadow-wars", shadowWars);
router.use("/fixed-tasks", fixedTasks);
router.use("/notifications", notifications);

module.exports = router;