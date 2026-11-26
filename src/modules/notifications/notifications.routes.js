import { Router } from 'express';
import * as Controller from './notifications.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';
import { pushLimiter, pushTestLimiter } from '../../shared/middlewares/rateLimit.js';

const router = Router();
router.use(requireAuth);

/** Avisos con la pestaña cerrada (Web Push). Voluntarios: cada persona activa o desactiva SOLO los de su navegador. */
router.get('/config', Controller.handleConfig);
router.post('/subscribe', pushLimiter, Controller.handleSubscribe);
router.post('/unsubscribe', pushLimiter, Controller.handleUnsubscribe);
router.post('/test', pushTestLimiter, Controller.handleTest); // una notificación de prueba a MIS navegadores (nunca a los de otra persona)

export default router;
