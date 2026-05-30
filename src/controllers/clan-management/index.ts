import { Router } from 'express';
import shadowWars    from './shadow-wars';
import accursedTower from './accursed-tower';
import clan         from './clan';
import history      from './history';

const router = Router();

router.use('/shadow-wars',    shadowWars);
router.use('/accursed-tower', accursedTower);
router.use('/clan',           clan);
router.use('/history',        history);

export default router;
