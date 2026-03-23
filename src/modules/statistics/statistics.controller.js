import { statisticsService } from './statistics.service.js';

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
    return res.status(500).json({ success: false, message: error.message });
  }
};
