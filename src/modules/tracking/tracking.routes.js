import { Router } from 'express';
import { logTrackingEvent } from './tracking.controller.js';

const router = Router();

router.post('/events', logTrackingEvent);

export default router;
