import { createSWManagementRouter } from './swLikeRouter';
import { VIGIL_OF_BLADES } from '../../helpers/activityKinds';

// Vigilia de Espadas: misma gestión que la Guerra Sombría (formación, confirmaciones…).
export default createSWManagementRouter(VIGIL_OF_BLADES);
