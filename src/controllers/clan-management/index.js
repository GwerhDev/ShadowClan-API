const router        = require('express').Router();
const shadowWars    = require('./shadow-wars');
const accursedTower = require('./accursed-tower');
const clan          = require('./clan');
const history       = require('./history');

router.use('/shadow-wars',    shadowWars);
router.use('/accursed-tower', accursedTower);
router.use('/clan',           clan);
router.use('/history',        history);

module.exports = router;
