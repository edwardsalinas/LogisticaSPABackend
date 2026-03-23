import { Router } from 'express';
import * as StatisticsController from './statistics.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();

/**
 * @swagger
 * /api/statistics/public:
 *   get:
 *     summary: Obtener estadísticas públicas para la página de login
 *     tags: [Statistics]
 *     responses:
 *       200:
 *         description: Estadísticas enviadas correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalPackages: { type: number }
 *                     packagesToday: { type: number }
 *                     activeUnits: { type: number }
 *                     efficiency: { type: number }
 */
router.get('/public', StatisticsController.handleGetPublicStats);

/**
 * @swagger
 * /api/statistics/dashboard:
 *   get:
 *     summary: Obtener estadísticas detalladas para el Dashboard (Protegido)
 *     tags: [Statistics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estadísticas detalladas enviadas correctamente
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Acceso denegado (Solo Admin/Operador)
 */
router.get('/dashboard', requireAuth, requireRole(['admin', 'logistics_operator']), StatisticsController.handleGetDashboardStats);

export default router;
