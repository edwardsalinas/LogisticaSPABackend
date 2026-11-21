import supabase from '../../shared/config/supabase.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from '../logistics/logistics.schema.js';

/**
 * Estadísticas calculadas con datos reales de la base. No se usan valores de relleno:
 * si no hay datos, el resultado es 0.
 */

const EARTH_RADIUS_KM = 6371;

/** Distancia entre dos coordenadas (fórmula de Haversine), en kilómetros. */
export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Variación porcentual formateada ("+12.5%"). Sin base de comparación: 100% si hubo actividad, 0% si no. */
export const formatChange = (current, previous) => {
  const pct = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};

const startOfDay = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

const count = async (query) => {
  const { count: total, error } = await query;
  if (error) throw error;
  return total || 0;
};

const countTable = (table) => supabase.from(table).select('*', { count: 'exact', head: true });
const countPackages = (status) => {
  const q = countTable('packages');
  return status ? q.eq('status', status) : q;
};

export const statisticsService = {
  /**
   * Estadísticas simplificadas para la página de login
   */
  async getPublicStats() {
    const [totalPackages, packagesToday, activeUnits, delivered] = await Promise.all([
      count(countPackages()),
      count(countPackages().gte('created_at', startOfDay())),
      count(countTable('transport_routes').eq('status', ROUTE_STATUS.ACTIVE)),
      count(countPackages(PACKAGE_STATUS.DELIVERED)),
    ]);

    const efficiency = totalPackages > 0 ? Math.round((delivered / totalPackages) * 1000) / 10 : 0;

    return { totalPackages, packagesToday, activeUnits, efficiency };
  },

  /**
   * Métricas detalladas para el Dashboard interno
   */
  async getDashboardStats() {
    const [
      totalVehicles,
      totalDrivers,
      packagesToday,
      packagesYesterday,
      activeRoutes,
      inTransit,
      pending,
      delivered,
      totalPackages,
    ] = await Promise.all([
      count(countTable('vehicles')),
      count(countTable('drivers')),
      count(countPackages().gte('created_at', startOfDay())),
      count(countPackages().gte('created_at', startOfDay(-1)).lt('created_at', startOfDay())),
      count(countTable('transport_routes').eq('status', ROUTE_STATUS.ACTIVE)),
      count(countPackages(PACKAGE_STATUS.IN_TRANSIT)),
      count(countPackages(PACKAGE_STATUS.PENDING)),
      count(countPackages(PACKAGE_STATUS.DELIVERED)),
      count(countPackages()),
    ]);

    // Distancia acumulada de las rutas completadas (Haversine entre origen y destino)
    let totalKm = 0;
    const { data: completed } = await supabase
      .from('transport_routes')
      .select('origin_lat, origin_lng, dest_lat, dest_lng')
      .eq('status', ROUTE_STATUS.COMPLETED);
    for (const r of completed || []) {
      if ([r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng].every((v) => typeof v === 'number')) {
        totalKm += haversineKm(r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng);
      }
    }

    // Retrasados: paquetes asignados cuya ruta ya debió salir (hora de salida vencida y el viaje no inició)
    let delayed = 0;
    try {
      delayed = await count(
        supabase
          .from('packages')
          .select('id, transport_routes!inner(departure_time)', { count: 'exact', head: true })
          .eq('status', PACKAGE_STATUS.ASSIGNED)
          .lt('transport_routes.departure_time', new Date().toISOString())
      );
    } catch (err) {
      console.warn('[Statistics] No se pudo calcular los despachos retrasados:', err.message);
    }

    return {
      totalVehicles,
      totalDrivers,
      packagesToday,
      activeRoutes,
      // El dashboard muestra la distancia en miles de km (sufijo "k")
      totalDistance: Math.round((totalKm / 1000) * 10) / 10,
      sla: totalPackages > 0 ? Math.round((delivered / totalPackages) * 100) : 0,
      performance: formatChange(packagesToday, packagesYesterday),
      packagesInTransit: inTransit,
      packagesPending: pending,
      packagesDelayed: delayed,
    };
  },
};
