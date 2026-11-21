import supabase from '../../shared/config/supabase.js';
import { PACKAGE_STATUS } from '../logistics/logistics.schema.js';

/**
 * Analítica real (página "Analítica" del panel). Todas las cifras salen de la base de datos:
 *  - volumen: paquetes creados por día, frente al período anterior de la misma duración.
 *  - a tiempo: entregados cuya fecha de entrega (delivered_at) es anterior o igual a la llegada estimada de su ruta.
 *  - ranking de conductores: entregas por conductor a través de la ruta del paquete.
 * No hay datos de "motivos de retraso" en el sistema, por lo que no se inventan: se muestra el estado de los envíos.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = -4 * 60 * 60 * 1000; // Bolivia (UTC-4, sin horario de verano)
export const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 5000;
const IN_CHUNK = 150;

export const STATUS_LABELS = {
  [PACKAGE_STATUS.PENDING]: { name: 'Pendiente', color: '#94a3b8' },
  [PACKAGE_STATUS.ASSIGNED]: { name: 'Asignado', color: '#3b82f6' },
  [PACKAGE_STATUS.IN_TRANSIT]: { name: 'En tránsito', color: '#f59e0b' },
  [PACKAGE_STATUS.AT_AGENCY]: { name: 'En agencia', color: '#8b5cf6' },
  [PACKAGE_STATUS.DELIVERED]: { name: 'Entregado', color: '#10b981' },
  [PACKAGE_STATUS.INCIDENT]: { name: 'Siniestro', color: '#ef4444' },
  [PACKAGE_STATUS.RETURNED]: { name: 'Devuelto', color: '#f97316' },
  [PACKAGE_STATUS.CANCELLED]: { name: 'Cancelado', color: '#64748b' },
};

// Día calendario de Bolivia (YYYY-MM-DD) de un instante
const localDay = (value) => new Date(new Date(value).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const dayStartMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`) - TZ_OFFSET_MS; // inicio del día boliviano en UTC
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dayLabel = (ymd) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const round1 = (n) => Math.round(n * 10) / 10;

/** Valida y normaliza el rango (YYYY-MM-DD, ambos incluidos). Por defecto, los últimos 30 días. */
export const parseRange = ({ from, to } = {}, now = new Date()) => {
  const toDay = to || localDay(now);
  const fromDay = from || localDay(new Date(dayStartMs(toDay) - 29 * DAY_MS));
  const start = dayStartMs(fromDay);
  const end = dayStartMs(toDay) + DAY_MS; // exclusivo
  const days = Math.round((end - start) / DAY_MS);
  if (!(days >= 1)) throw Object.assign(new Error('El rango de fechas no es válido: "desde" debe ser anterior o igual a "hasta"'), { status: 400 });
  if (days > MAX_RANGE_DAYS) throw Object.assign(new Error(`El rango máximo es de ${MAX_RANGE_DAYS} días`), { status: 400 });
  return { fromDay, toDay, start, end, days, prevStart: start - days * DAY_MS };
};

/** Cálculo puro de la analítica a partir de filas ya cargadas (fácil de probar). */
export const buildAnalytics = ({ packages, routes = {}, drivers = {}, range }) => {
  const { start, end, days, prevStart } = range;
  const ts = (p) => new Date(p.created_at).getTime();
  const current = packages.filter((p) => ts(p) >= start && ts(p) < end);
  const previous = packages.filter((p) => ts(p) >= prevStart && ts(p) < start);

  const isDelivered = (p) => p.status === PACKAGE_STATUS.DELIVERED;
  const delivered = current.filter(isDelivered);
  const estimate = (p) => {
    const r = p.route_id ? routes[p.route_id] : null;
    return r?.estimated_arrival && p.delivered_at ? new Date(r.estimated_arrival).getTime() : null;
  };
  const onTimeOf = (p) => new Date(p.delivered_at).getTime() <= estimate(p);

  const measurable = delivered.filter((p) => estimate(p) !== null);
  const onTimeCount = measurable.filter(onTimeOf).length;

  const withDuration = delivered.filter((p) => p.delivered_at);
  const avgDeliveryHours = withDuration.length
    ? round1(withDuration.reduce((sum, p) => sum + (new Date(p.delivered_at) - new Date(p.created_at)), 0) / withDuration.length / 3600000)
    : null;

  // Tendencia diaria: período actual frente al anterior, alineados por número de día
  const trend = Array.from({ length: days }, (_, i) => ({
    date: dayLabel(localDay(start + i * DAY_MS)),
    actual: 0,
    previous: 0,
  }));
  for (const p of current) trend[Math.min(days - 1, Math.floor((ts(p) - start) / DAY_MS))].actual += 1;
  for (const p of previous) trend[Math.min(days - 1, Math.floor((ts(p) - prevStart) / DAY_MS))].previous += 1;

  const counts = {};
  for (const p of current) counts[p.status] = (counts[p.status] || 0) + 1;
  const statusBreakdown = Object.entries(counts)
    .map(([status, value]) => ({ status, name: STATUS_LABELS[status]?.name ?? status, color: STATUS_LABELS[status]?.color ?? '#94a3b8', value }))
    .sort((a, b) => b.value - a.value);

  const perDriver = {};
  for (const p of delivered) {
    const driverId = p.route_id ? routes[p.route_id]?.driver_id : null;
    if (!driverId) continue;
    const d = (perDriver[driverId] ??= { id: driverId, name: drivers[driverId]?.full_name || 'Conductor sin nombre', deliveries: 0, measurable: 0, onTime: 0 });
    d.deliveries += 1;
    if (estimate(p) !== null) {
      d.measurable += 1;
      if (onTimeOf(p)) d.onTime += 1;
    }
  }
  const driversRanking = Object.values(perDriver)
    .map((d) => ({ id: d.id, name: d.name, deliveries: d.deliveries, onTime: d.onTime, efficiency: d.measurable ? round1((d.onTime / d.measurable) * 100) : null }))
    .sort((a, b) => (b.efficiency ?? -1) - (a.efficiency ?? -1) || b.deliveries - a.deliveries)
    .slice(0, 10);

  const prevCount = previous.length;
  return {
    range: { from: range.fromDay, to: range.toDay, days },
    totals: {
      shipments: current.length,
      previousShipments: prevCount,
      change: prevCount ? Math.round(((current.length - prevCount) / prevCount) * 100) : null,
      delivered: delivered.length,
      onTimePct: measurable.length ? round1((onTimeCount / measurable.length) * 100) : null,
      onTimeSample: measurable.length,
      avgDeliveryHours,
      incidents: counts[PACKAGE_STATUS.INCIDENT] || 0,
    },
    trend,
    statusBreakdown,
    drivers: driversRanking,
    truncated: packages.length >= MAX_ROWS,
  };
};

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

export const getAnalytics = async (query, db = supabase) => {
  const range = parseRange(query);
  const { data: packages, error } = await db
    .from('packages')
    .select('id, status, created_at, delivered_at, route_id')
    .gte('created_at', new Date(range.prevStart).toISOString())
    .lt('created_at', new Date(range.end).toISOString())
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw error;

  const routeIds = [...new Set((packages || []).map((p) => p.route_id).filter(Boolean))];
  const routes = {};
  for (const ids of chunk(routeIds, IN_CHUNK)) {
    const { data, error: routesError } = await db.from('transport_routes').select('id, driver_id, estimated_arrival').in('id', ids);
    if (routesError) throw routesError;
    for (const r of data || []) routes[r.id] = r;
  }

  const driverIds = [...new Set(Object.values(routes).map((r) => r.driver_id).filter(Boolean))];
  const drivers = {};
  for (const ids of chunk(driverIds, IN_CHUNK)) {
    const { data, error: driversError } = await db.from('drivers').select('id, full_name').in('id', ids);
    if (driversError) throw driversError;
    for (const d of data || []) drivers[d.id] = d;
  }

  return buildAnalytics({ packages: packages || [], routes, drivers, range });
};
