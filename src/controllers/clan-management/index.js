const router = require('express').Router();
const shadowWars = require('./shadow-wars');
const clan      = require('./clan');

router.use('/shadow-wars', shadowWars);
router.use('/clan', clan);

module.exports = router;
