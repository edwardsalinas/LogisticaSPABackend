import { Router } from 'express';
import { logTrackingEvent, getTrackingLogs } from './tracking.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();

/**
 * @swagger
 * /api/tracking/events:
 *   post:
 *     summary: Registrar un evento de tracking (GPS/Status)
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               package_id:
 *                 type: string
 *                 format: uuid
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               status:
 *                 type: string
 *     responses:
 *       201:
 *         description: Evento registrado
 */
router.post('/', requireAuth, logTrackingEvent);
router.post('/events', requireAuth, requireRole(['admin', 'driver']), logTrackingEvent);
router.get('/logs/:packageId', requireAuth, getTrackingLogs);

export default router;
