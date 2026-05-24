const router = require('express').Router();
const clans = require('./clans');
const users = require('./users');
const warbands = require('./warbands');
const characters = require('./characters');
const shadowWars = require('./shadow-wars');
const fixedTasks = require('./fixed-tasks');
const notifications = require('./notifications');
const clanRequests = require('./clan-requests');

router.use("/users", users);
router.use("/clans", clans);
router.use("/warbands", warbands);
router.use("/characters", characters);
router.use("/shadow-wars", shadowWars);
router.use("/fixed-tasks", fixedTasks);
router.use("/notifications", notifications);
router.use("/clan-requests", clanRequests);

module.exports = router;