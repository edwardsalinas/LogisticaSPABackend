import { Router } from 'express';
import * as FleetController from './fleet.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();
router.use(requireAuth);

/**
 * @swagger
 * /api/fleet/vehicles:
 *   get:
 *     summary: Listar todos los vehículos
 *     tags: [Fleet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de vehículos
 *   post:
 *     summary: Crear un nuevo vehículo
 *     tags: [Fleet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plate: { type: string }
 *               model: { type: string }
 *               type: { type: string }
 *               capacity_kg: { type: number }
 *     responses:
 *       201:
 *         description: Vehículo creado
 */
router.get('/vehicles', FleetController.handleGetVehicles);
router.post('/vehicles', requireRole(['admin']), FleetController.handleCreateVehicle);

/**
 * @swagger
 * /api/fleet/drivers:
 *   post:
 *     summary: Registrar un nuevo chofer
 *     tags: [Fleet]
 *     security:
 *       - bearerAuth: []
 */
router.get('/drivers', FleetController.handleGetDrivers);
router.post('/drivers', requireRole(['admin', 'driver']), FleetController.handleRegisterDriver);

router.get('/clients', requireRole(['admin', 'logistics_operator']), FleetController.handleGetClients);

export default router;
