import { Router } from 'express';
import { logTrackingEvent, getTrackingLogs } from './tracking.controller.js';
import { requireAuth, requireRole } from '../../shared/middlewares/auth.js';

const router = Router();

router.post('/', requireAuth, logTrackingEvent);
router.post('/events', requireAuth, requireRole(['admin', 'driver']), logTrackingEvent);
router.get('/logs/:packageId', requireAuth, getTrackingLogs);

export default router;
