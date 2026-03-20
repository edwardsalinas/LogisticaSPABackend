import { Router } from 'express';
import { checkpointsController } from './checkpoints.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/routes/:routeId/checkpoints', checkpointsController.getByRoute.bind(checkpointsController));
router.post('/routes/:routeId/checkpoints', checkpointsController.create.bind(checkpointsController));
router.put('/routes/:routeId/checkpoints/:checkpointId', checkpointsController.update.bind(checkpointsController));
router.delete('/routes/:routeId/checkpoints/:checkpointId', checkpointsController.delete.bind(checkpointsController));
router.post('/routes/:routeId/checkpoints/reorder', checkpointsController.reorder.bind(checkpointsController));

export default router;
