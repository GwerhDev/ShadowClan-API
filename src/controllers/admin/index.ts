import { Router } from 'express';
import { roles } from '../../misc/consts-user-model';
import { authorizeRoles } from '../../middlewares';

import overview                   from './overview';
import clans                      from './clans';
import users                      from './users';
import warbands                   from './warbands';
import characters                 from './characters';
import shadowWars                 from './shadow-wars';
import fixedTasks                 from './fixed-tasks';
import notifications              from './notifications';
import clanRequests               from './clan-requests';
import characterClaims            from './character-claims';
import characterCreationRequests  from './character-creation-requests';
import clanCreationRequests       from './clan-creation-requests';
import clanClaimRequests          from './clan-claim-requests';
import userActivations            from './user-activations';

const superAdminOnly  = authorizeRoles([roles.superAdmin]);
const adminOrAbove    = authorizeRoles([roles.admin, roles.superAdmin]);

const router = Router();

router.use('/overview',                       overview);
router.use('/users',           superAdminOnly, users);
router.use('/clans',           adminOrAbove,   clans);
router.use('/warbands',                        warbands);
router.use('/characters',      superAdminOnly, characters);
router.use('/shadow-wars',                     shadowWars);
router.use('/fixed-tasks',                     fixedTasks);
router.use('/notifications',                   notifications);
router.use('/clan-requests',                   clanRequests);
router.use('/character-claims',                characterClaims);
router.use('/character-creation-requests',     characterCreationRequests);
router.use('/clan-creation-requests',          clanCreationRequests);
router.use('/clan-claim-requests',             clanClaimRequests);
router.use('/user-activations',                userActivations);

export default router;
