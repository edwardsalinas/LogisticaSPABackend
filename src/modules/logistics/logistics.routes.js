import { Router } from 'express';
import * as LogisticsController from './logistics.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();
router.use(requireAuth);

/**
 * @swagger
 * /api/logistics/packages:
 *   post:
 *     summary: Registrar un nuevo paquete
 *     tags: [Logistics]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               origen: { type: string }
 *               destino: { type: string }
 *               peso: { type: number }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Paquete creado
 */
router.get('/packages', LogisticsController.handleGetPackages);
router.post('/packages', requireRole(['admin', 'logistics_operator']), LogisticsController.handleCreatePackage);

/**
 * @swagger
 * /api/logistics/routes:
 *   get:
 *     summary: Obtener todas las rutas de transporte
 *     tags: [Logistics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de rutas obtenida
 *   post:
 *     summary: Crear una nueva ruta de transporte
 *     tags: [Logistics]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [origin, destination, vehicle_id, driver_id]
 *             properties:
 *               origin: { type: string }
 *               destination: { type: string }
 *               vehicle_id: { type: string, format: uuid }
 *               driver_id: { type: string, format: uuid }
 *               departure_time: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Ruta creada
 */
router.get('/routes', LogisticsController.handleGetRoutes);
router.get('/routes/:id', LogisticsController.handleGetRoute);
router.post('/routes', requireRole(['admin', 'logistics_operator']), LogisticsController.handleCreateRoute);

/**
 * @swagger
 * /api/logistics/routes/{id}/assign:
 *   post:
 *     summary: Asignar paquete a una ruta
 *     tags: [Logistics]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [package_id]
 *             properties:
 *               package_id: { type: string, format: uuid }
 */
router.post('/routes/:id/assign', requireRole(['admin', 'logistics_operator']), LogisticsController.handleAssignPackage);

export default router;
