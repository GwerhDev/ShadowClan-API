import { Router } from 'express';
import { roles } from '../misc/consts-user-model';
import { authorizeRoles } from '../middlewares';

import admin                    from '../controllers/admin';
import clanManagement           from '../controllers/clan-management';
import auth                     from '../controllers/auth';
import clan                     from '../controllers/clan';
import task                     from '../controllers/task';
import crest                    from '../controllers/crest';
import guide                    from '../controllers/guide';
import logout                   from '../controllers/logout';
import warband                  from '../controllers/warband';
import character                from '../controllers/character';
import loginBnet                from '../controllers/login-bnet';
import shadowWar                from '../controllers/shadow-war';
import accursedTower            from '../controllers/accursed-tower';
import signupBnet               from '../controllers/signup-bnet';
import completedTask            from '../controllers/completed-task';
import clanPost                 from '../controllers/clan-post';
import clanRequest              from '../controllers/clan-request';
import clanInvitation           from '../controllers/clan-invitation';
import characterClaim           from '../controllers/character-claim';
import characterCreationRequest from '../controllers/character-creation-request';
import clanCreationRequest      from '../controllers/clan-creation-request';
import clanClaimRequest         from '../controllers/clan-claim-request';

const router = Router();

router.use('/admin',           authorizeRoles([roles.superAdmin, roles.admin]), admin);
router.use('/clan-management', authorizeRoles([roles.leader, roles.officer, roles.admin, roles.superAdmin]), clanManagement);

router.use('/auth',                        auth);
router.use('/clan',                        clan);
router.use('/task',                        task);
router.use('/crest',                       crest);
router.use('/guide',                       guide);
router.use('/logout',                      logout);
router.use('/warband',                     warband);
router.use('/character',                   character);
router.use('/shadow-war',                  shadowWar);
router.use('/accursed-tower',              accursedTower);
router.use('/login-bnet',                  loginBnet);
router.use('/signup-bnet',                 signupBnet);
router.use('/completed-task',              completedTask);
router.use('/clan-post',                   clanPost);
router.use('/clan-request',                clanRequest);
router.use('/clan-invitation',             clanInvitation);
router.use('/character-claim',             characterClaim);
router.use('/character-creation-request',  characterCreationRequest);
router.use('/clan-creation-request',       clanCreationRequest);
router.use('/clan-claim-request',          clanClaimRequest);

export default router;
