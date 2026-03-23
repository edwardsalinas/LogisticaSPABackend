import { Router } from 'express';
import * as StatisticsController from './statistics.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();

/**
 * Endpoint Público: Estadísticas agregadas para el login
 */
router.get('/public', StatisticsController.handleGetPublicStats);

/**
 * Endpoint Privado: Métricas detalladas para el Dashboard
 */
router.get('/dashboard', requireAuth, requireRole(['admin', 'logistics_operator']), StatisticsController.handleGetDashboardStats);

export default router;
