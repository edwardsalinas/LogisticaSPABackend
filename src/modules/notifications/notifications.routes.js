import { Router } from 'express';
import * as Controller from './notifications.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';
import { pushLimiter } from '../../shared/middlewares/rateLimit.js';

const router = Router();
router.use(requireAuth);

/** Avisos con la pestaña cerrada (Web Push). Voluntarios: cada persona activa o desactiva SOLO los de su navegador. */
router.get('/config', Controller.handleConfig);
router.post('/subscribe', pushLimiter, Controller.handleSubscribe);
router.post('/unsubscribe', pushLimiter, Controller.handleUnsubscribe);

export default router;
