import { Router } from 'express';
import shadowWars    from './shadow-wars';
import accursedTower from './accursed-tower';
import clan         from './clan';
import history      from './history';
import attendance   from './attendance';
import statistics   from './statistics';
import seasons      from './seasons';

const router = Router();

router.use('/shadow-wars',    shadowWars);
router.use('/accursed-tower', accursedTower);
router.use('/clan',           clan);
router.use('/history',        history);
router.use('/attendance',     attendance);
router.use('/statistics',     statistics);
router.use('/seasons',        seasons);

export default router;
