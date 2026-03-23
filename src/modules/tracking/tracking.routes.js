import { Router } from 'express';
import { logTrackingEvent, getTrackingLogs, handleGetMapData, handleLogTripEvent, handleGetRouteTracking, handleGetPublicTracking } from './tracking.controller.js';
import { handleStartTrip, handleStopTrip, handleGetActiveTrip } from './trips.controller.js';
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

/**
 * @swagger
 * /api/tracking/logs/{packageId}:
 *   get:
 *     summary: Obtener el historial completo de eventos de un paquete
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lista de eventos obtenida
 */
router.get('/logs/:packageId', requireAuth, getTrackingLogs);

/**
 * @swagger
 * /api/tracking/{packageId}/map-data:
 *   get:
 *     summary: Obtener todos los datos necesarios para renderizar el mapa de tracking
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Datos estratégicos del mapa (Ruta, Checkpoints, Última posición)
 */
router.get('/:packageId/map-data', requireAuth, handleGetMapData);

/**
 * @swagger
 * /api/tracking/trip/start:
 *   post:
 *     summary: Iniciar un viaje (conductor activa tracking GPS)
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               route_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Viaje iniciado
 *       409:
 *         description: Ya existe un viaje activo
 */
router.post('/trip/start', requireAuth, requireRole(['driver']), handleStartTrip);

/**
 * @swagger
 * /api/tracking/trip/stop:
 *   post:
 *     summary: Finalizar el viaje activo (detiene tracking GPS)
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Viaje finalizado
 */
router.post('/trip/stop', requireAuth, requireRole(['driver']), handleStopTrip);

/**
 * @swagger
 * /api/tracking/trip/active:
 *   get:
 *     summary: Obtener viaje activo del conductor
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Viaje activo o null
 */
router.get('/trip/active', requireAuth, requireRole(['driver']), handleGetActiveTrip);

/**
 * @swagger
 * /api/tracking/trip/{tripId}/event:
 *   post:
 *     summary: Registrar evento de GPS para un viaje activo
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.post('/trip/:tripId/event', requireAuth, requireRole(['driver']), handleLogTripEvent);
/**
 * @swagger
 * /api/tracking/route/{routeId}:
 *   get:
 *     summary: Obtener historial de tracking de una ruta completa
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 */
router.get('/route/:routeId', requireAuth, handleGetRouteTracking);

/**
 * @swagger
 * /api/tracking/public/{code}:
 *   get:
 *     summary: Rastreo público (anónimo) mediante código de tracking
 *     tags: [Tracking]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Información de rastreo encontrada
 *       404:
 *         description: Código no encontrado
 */
router.get('/public/:code', handleGetPublicTracking);

export default router;
