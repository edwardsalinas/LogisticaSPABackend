import { z } from 'zod';
import { statisticsService } from './statistics.service.js';
import { getAnalytics } from './analytics.service.js';

/**
 * Maneja la petición de estadísticas públicas para el login
 */
export const handleGetPublicStats = async (req, res) => {
  try {
    const stats = await statisticsService.getPublicStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching public stats:', error);
    return res.status(500).json({ success: false, message: 'Dinamización de estadísticas no disponible temporalmente' });
  }
};

/**
 * Maneja la petición de estadísticas detalladas para el dashboard
 */
export const handleGetDashboardStats = async (req, res) => {
  try {
    const stats = await statisticsService.getDashboardStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'No se pudieron obtener las estadísticas' });
  }
};

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');
export const analyticsQuerySchema = z.object({ from: ymd.optional(), to: ymd.optional() });

/**
 * Analítica real para la página "Analítica" (solo administradores).
 */
export const handleGetAnalytics = async (req, res) => {
  try {
    const query = analyticsQuerySchema.parse(req.query);
    const data = await getAnalytics(query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    }
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error('Error fetching analytics:', error);
    return res.status(500).json({ success: false, message: 'No se pudo calcular la analítica' });
  }
};
