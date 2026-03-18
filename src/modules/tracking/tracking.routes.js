import { Router } from 'express';
import { logTrackingEvent } from './tracking.controller.js';
import { requireAuth, requireRole } from '../../shared/middlewares/auth.js';

const router = Router();

router.post('/events', requireAuth, requireRole(['admin', 'driver']), logTrackingEvent);

export default router;
