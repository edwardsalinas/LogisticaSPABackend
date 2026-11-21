import { Router } from 'express';
import { logTrackingEvent, getTrackingLogs, handleGetMapData, handleLogTripEvent, handleLogTripEventsBatch, handleGetRouteTracking, handleGetPublicTracking } from './tracking.controller.js';
import { handleStartTrip, handleStopTrip, handleGetActiveTrip } from './trips.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';
import { publicTrackingLimiter } from '../../shared/middlewares/rateLimit.js';
import { requireCaptcha } from '../../shared/middlewares/captcha.js';

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
router.post('/', requireAuth, requireRole(['admin', 'logistics_operator', 'driver']), logTrackingEvent);
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
 *     description: >
 *       Acepta un `timestamp` ISO 8601 opcional con el instante real de la lectura GPS
 *       (útil cuando el punto estuvo en la cola offline del dispositivo).
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lat: { type: number }
 *               lng: { type: number }
 *               status: { type: string }
 *               timestamp: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Evento registrado
 */
router.post('/trip/:tripId/event', requireAuth, requireRole(['driver']), handleLogTripEvent);

/**
 * @swagger
 * /api/tracking/trip/{tripId}/events/batch:
 *   post:
 *     summary: Registrar varios puntos GPS acumulados offline (hasta 200)
 *     description: >
 *       Los puntos se procesan en orden cronológico. Si ocurre un error, la respuesta incluye
 *       `processed` con la cantidad de puntos ya registrados para que el cliente pueda reintentar
 *       solo el resto.
 *     tags: [Tracking]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tripId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [points]
 *             properties:
 *               points:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [lat, lng, timestamp]
 *                   properties:
 *                     lat: { type: number }
 *                     lng: { type: number }
 *                     status: { type: string }
 *                     timestamp: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Puntos registrados
 *       400:
 *         description: Payload inválido
 */
router.post('/trip/:tripId/events/batch', requireAuth, requireRole(['driver']), handleLogTripEventsBatch);
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
router.get('/route/:routeId', requireAuth, requireRole(['admin', 'logistics_operator', 'driver']), handleGetRouteTracking);

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
router.get('/public/:code', publicTrackingLimiter, requireCaptcha, handleGetPublicTracking);

export default router;
