import { Router } from 'express';
import { logTrackingEvent } from './tracking.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();

router.post('/', requireAuth, logTrackingEvent);
router.post('/events', requireAuth, requireRole(['admin', 'driver']), logTrackingEvent);
router.get('/logs/:packageId', requireAuth, getTrackingLogs);

export default router;
