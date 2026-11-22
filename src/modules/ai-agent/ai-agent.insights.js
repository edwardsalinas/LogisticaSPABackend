import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PACKAGE_STATUS } from '../logistics/logistics.schema.js';
import { getAnalytics } from '../statistics/analytics.service.js';

/**
 * Herramientas de lectura que resumen mucho en UNA llamada (menos pasos del agente = respuestas más rápidas):
 * el resumen del día con las prioridades ya calculadas, y la analítica de un período.
 * Solo administradores y operadores.
 */
const OPS = ['admin', 'logistics_operator'];
const DENIED = 'No tienes permiso para consultar esa información.';
const MAX_ITEMS = 5;
const asText = (v) => JSON.stringify(v);

const TZ_OFFSET_MS = -4 * 60 * 60 * 1000;
/** Inicio y fin del día de hoy en Bolivia, en ISO. */
export const todayBoundsBolivia = (now = Date.now()) => {
  const d = new Date(now + TZ_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  const start = d.getTime() - TZ_OFFSET_MS;
  return { startISO: new Date(start).toISOString(), endISO: new Date(start + 24 * 60 * 60 * 1000 - 1).toISOString(), day: d.toISOString().slice(0, 10) };
};

/** Prioridades del día en frase corta, ya ordenadas por urgencia (lo decide el servidor, no el modelo). */
export const buildPriorities = ({ incidents = 0, delayed = 0, unassigned = 0, departuresToday = 0, activeRoutes = 0 }) => {
  const out = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (incidents > 0) out.push(`Atender ${plural(incidents, 'paquete con siniestro', 'paquetes con siniestro')}`);
  if (delayed > 0) out.push(`Revisar ${plural(delayed, 'paquete retrasado', 'paquetes retrasados')} (su ruta ya debió salir)`);
  if (unassigned > 0) out.push(`Asignar a un viaje ${plural(unassigned, 'paquete pendiente', 'paquetes pendientes')}`);
  if (departuresToday > 0) out.push(`Hoy salen ${plural(departuresToday, 'viaje', 'viajes')}`);
  if (out.length === 0) out.push(activeRoutes > 0 ? 'Sin pendientes urgentes; hay rutas en curso' : 'Sin pendientes urgentes');
  return out;
};

export const buildInsightTools = (user, db, statsService) => {
  const dailyBriefing = tool(
    async () => {
      try {
        if (!OPS.includes(user.role)) return DENIED;
        const { startISO, endISO, day } = todayBoundsBolivia();
        const cols = 'tracking_code, status, origen, destino, recipient_name, created_at';
        const [stats, incidents, delayed, unassigned, departures] = await Promise.all([
          statsService.getDashboardStats(),
          db.from('packages').select(cols).eq('status', PACKAGE_STATUS.INCIDENT).order('created_at', { ascending: false }).limit(MAX_ITEMS),
          db.from('packages').select(`${cols}, transport_routes!inner(departure_time)`).eq('status', PACKAGE_STATUS.ASSIGNED).lt('transport_routes.departure_time', new Date().toISOString()).limit(MAX_ITEMS),
          db.from('packages').select('tracking_code, origen, destino, peso, created_at', { count: 'exact' }).eq('status', PACKAGE_STATUS.PENDING).order('created_at', { ascending: true }).limit(MAX_ITEMS),
          db.from('transport_routes').select('origin, destination, departure_time, estimated_arrival, status').in('status', ['planeada', 'en_transito']).gte('departure_time', startISO).lte('departure_time', endISO).order('departure_time', { ascending: true }).limit(MAX_ITEMS),
        ]);
        for (const r of [incidents, delayed, unassigned, departures]) if (r.error) throw r.error;

        const attention = [
          ...(incidents.data || []).map((p) => ({ tracking_code: p.tracking_code, route: `${p.origen} → ${p.destino}`, reason: 'siniestro' })),
          ...(delayed.data || []).map((p) => ({ tracking_code: p.tracking_code, route: `${p.origen} → ${p.destino}`, reason: 'retrasado: su ruta ya debió salir' })),
        ];
        const unassignedCount = unassigned.count ?? (unassigned.data || []).length;
        return asText({
          kind: 'daily_briefing',
          date: day,
          kpis: {
            in_transit: stats.packagesInTransit, pending: stats.packagesPending, delayed: stats.packagesDelayed,
            incidents: stats.packagesIncident, at_agency: stats.packagesAtAgency, active_routes: stats.activeRoutes,
            packages_today: stats.packagesToday, delivery_rate_pct: stats.sla,
          },
          priorities: buildPriorities({ incidents: stats.packagesIncident, delayed: stats.packagesDelayed, unassigned: unassignedCount, departuresToday: (departures.data || []).length, activeRoutes: stats.activeRoutes }),
          attention,
          unassigned: { count: unassignedCount, oldest: (unassigned.data || []).map((p) => ({ tracking_code: p.tracking_code, route: `${p.origen} → ${p.destino}`, peso: p.peso })) },
          departures_today: (departures.data || []).map((r) => ({ origin: r.origin, destination: r.destination, departure_time: r.departure_time, status: r.status })),
        });
      } catch (e) {
        return `No se pudo preparar el resumen del día: ${e.message}`;
      }
    },
    {
      name: 'get_daily_briefing',
      description: 'Resumen completo del día en UNA llamada: indicadores, prioridades ya ordenadas por urgencia, paquetes que requieren atención (siniestros y retrasados), paquetes pendientes sin viaje y los viajes que salen hoy. Solo administradores y operadores. Úsala para "dame el resumen del día", "¿qué tengo que hacer hoy?" o "¿por dónde empiezo?".',
      schema: z.object({}),
    }
  );

  const analyticsSummary = tool(
    async ({ from, to }) => {
      try {
        if (!OPS.includes(user.role)) return DENIED;
        const a = await getAnalytics({ ...(from ? { from } : {}), ...(to ? { to } : {}) }, db);
        return asText({
          kind: 'analytics_summary',
          range: a.range,
          totals: a.totals,
          status_breakdown: a.statusBreakdown.map(({ name, value }) => ({ name, value })),
          top_drivers: a.drivers.slice(0, MAX_ITEMS).map(({ name, deliveries, onTime, efficiency }) => ({ name, deliveries, on_time: onTime, efficiency_pct: efficiency })),
          busiest_days: [...a.trend].sort((x, y) => y.actual - x.actual).filter((d) => d.actual > 0).slice(0, 3).map((d) => ({ date: d.date, packages: d.actual })),
        });
      } catch (e) {
        if (e.status === 400) return e.message; // rango inválido: se explica
        return `No se pudo calcular la analítica: ${e.message}`;
      }
    },
    {
      name: 'get_analytics_summary',
      description: 'Analítica de un período (por defecto los últimos 30 días, máximo 92): envíos, variación frente al período anterior, entregas a tiempo, tiempo medio de entrega, siniestros, estado de los envíos, mejores conductores y días de más movimiento. Solo administradores y operadores. Úsala para "¿cómo fue el mes?", "¿cuántos envíos hicimos esta semana?" o "¿quién entrega mejor?". Fechas AAAA-MM-DD.',
      schema: z.object({
        from: z.string().optional().describe('Inicio AAAA-MM-DD'),
        to: z.string().optional().describe('Fin AAAA-MM-DD (incluido)'),
      }),
    }
  );

  return [dailyBriefing, analyticsSummary];
};
