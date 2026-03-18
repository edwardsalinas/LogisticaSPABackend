import { Router } from 'express';
import * as LogisticsController from './logistics.controller.js';
import { requireAuth, requireRole } from '../../shared/middlewares/auth.js';

const router = Router();
router.use(requireAuth);

router.post('/packages', requireRole(['admin', 'client']), LogisticsController.handleCreatePackage);
router.post('/routes', requireRole(['admin', 'logistics_operator']), LogisticsController.handleCreateRoute);
router.post('/routes/:id/assign', requireRole(['admin', 'logistics_operator']), LogisticsController.handleAssignPackage);

export default router;
