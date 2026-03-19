import { Router } from 'express';
import { logTrackingEvent } from './tracking.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();

router.post('/events', requireAuth, requireRole(['admin', 'driver']), logTrackingEvent);

export default router;
