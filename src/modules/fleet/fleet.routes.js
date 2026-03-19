import { Router } from 'express';
import * as FleetController from './fleet.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();
router.use(requireAuth);

/**
 * Gestión de Vehículos
 * Acceso: Admin, Operador
 */
router.get('/vehicles', FleetController.handleGetVehicles);
router.post('/vehicles', requireRole(['admin']), FleetController.handleCreateVehicle);

/**
 * Gestión de Choferes
 * Acceso: Admin (para registro masivo) o Chofer (para su propio perfil)
 */
router.post('/drivers', requireRole(['admin', 'driver']), FleetController.handleRegisterDriver);

export default router;
