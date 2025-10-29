const router = require('express').Router();
const admin = require('../controllers/admin');

const auth = require('../controllers/auth');
const task = require('../controllers/task');
const crest = require('../controllers/crest');
const guide = require('../controllers/guide');
const warband = require('../controllers/warband');
const character = require('../controllers/character');
const loginBnet = require('../controllers/login-bnet');
const shadowWar = require('../controllers/shadow-war');
const signupBnet = require('../controllers/signup-bnet');
const completedTask = require('../controllers/completed-task');

router.use("/admin", admin);

router.use("/auth", auth);
router.use("/task", task);
router.use("/crest", crest);
router.use("/guide", guide);
router.use("/warband", warband);
router.use("/character", character);
router.use("/shadow-war", shadowWar);
router.use("/login-bnet", loginBnet);
router.use("/signup-bnet", signupBnet);
router.use("/completed-task", completedTask);

module.exports = router;