import { createHash } from 'node:crypto';
import { loadAssignmentPlan } from './ai-agent.suggestions.js';

/**
 * Avisos proactivos de Logi: excepciones reales de la operación, calculadas por el servidor (reglas fijas, SIN modelo de
 * IA: no gastan consultas ni inventan nada). Cada aviso trae una acción posible y un identificador estable para que la
 * pantalla no repita el mismo aviso. Solo administradores y operadores.
 *
 * Criterios de diseño (Clippy, estudios de asistentes proactivos): pocos avisos, atados a lo que está ocurriendo de
 * verdad, ordenados por urgencia, y siempre descartables. La pantalla decide cuándo mostrarlos y con qué frecuencia.
 */
const OPS = ['admin', 'logistics_operator'];
const HOUR_MS = 60 * 60 * 1000;
const DELAY_GRACE_MS = 30 * 60 * 1000; // un viaje que no sale en 30 minutos ya es un retraso
const DELAY_WINDOW_MS = 24 * HOUR_MS; // y se avisa hasta un día después (más viejo ya es historia, no urgencia)
const NO_DRIVER_WINDOW_MS = 24 * HOUR_MS;
export const MAX_ALERTS = 3;

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 };
const shortId = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const timeLabel = (iso) => new Date(iso).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false });
const dayLabel = (iso, now) => {
  const fmt = (t) => new Date(t).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' });
  if (fmt(iso) === fmt(now)) return 'hoy';
  if (fmt(iso) === fmt(now + 24 * HOUR_MS)) return 'mañana';
  return new Date(iso).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', day: 'numeric', month: 'long' });
};

/** Paquetes sueltos que caben en un viaje planeado de su misma ruta: la oportunidad más accionable. */
const assignAlert = (group, now) => {
  const codes = group.packages.map((p) => p.tracking_code);
  const n = codes.length;
  const space = group.free_kg != null ? `, ${group.total_kg} kg de ${group.free_kg} kg libres` : '';
  return {
    id: `assign:${shortId(`${group.route_ref}|${[...codes].sort().join(',')}`)}`,
    type: 'assign',
    severity: 'medium',
    title: 'Paquetes sueltos con viaje disponible',
    text: `${plural(n, 'paquete suelto', 'paquetes sueltos')} de ${group.origin} a ${group.destination} ${n === 1 ? 'cabe' : 'caben'} en el viaje que sale ${dayLabel(group.departure_time, now)} a las ${timeLabel(group.departure_time)}${space}.`,
    // la pantalla prepara la propuesta con el endpoint de sugerencias (se confirma como siempre) y Logi la muestra
    action: { kind: 'prepare_assign', route_ref: group.route_ref, codes },
  };
};

const delayedAlert = (routes) => {
  const n = routes.length;
  const first = routes[0];
  return {
    id: `delayed:${shortId(routes.map((r) => r.id).sort().join(','))}`,
    type: 'delayed',
    severity: 'high',
    title: n === 1 ? 'Un viaje no ha salido' : 'Viajes que no han salido',
    text: n === 1
      ? `El viaje de ${first.origin} a ${first.destination} debía salir a las ${timeLabel(first.departure_time)} y sigue sin iniciar.`
      : `${n} viajes debieron salir y siguen sin iniciar (el más antiguo, ${first.origin} → ${first.destination}, a las ${timeLabel(first.departure_time)}).`,
    action: n === 1 ? { kind: 'navigate', to: `/logistics/routes/${first.id}/map`, label: 'Ver el viaje' } : { kind: 'navigate', to: '/logistics/routes', label: 'Ver los viajes' },
  };
};

const noDriverAlert = (routes, now) => {
  const n = routes.length;
  const first = routes[0];
  return {
    id: `no_driver:${shortId(routes.map((r) => r.id).sort().join(','))}`,
    type: 'no_driver',
    severity: 'medium',
    title: n === 1 ? 'Un viaje sin conductor' : 'Viajes sin conductor',
    text: n === 1
      ? `El viaje de ${first.origin} a ${first.destination} sale ${dayLabel(first.departure_time, now)} a las ${timeLabel(first.departure_time)} y no tiene conductor asignado.`
      : `${n} viajes salen en las próximas 24 horas sin conductor (el primero, ${first.origin} → ${first.destination}, ${dayLabel(first.departure_time, now)} a las ${timeLabel(first.departure_time)}).`,
    action: { kind: 'navigate', to: '/logistics/routes', label: 'Ver los viajes' },
  };
};

/**
 * Convierte los datos ya leídos en avisos ordenados por urgencia. Función pura (fácil de probar).
 * @param {{ group?: object|null, delayed?: object[], noDriver?: object[], now?: number }} input
 */
export const planAlerts = ({ group = null, delayed = [], noDriver = [], now = Date.now() }) => {
  const alerts = [];
  if (delayed.length) alerts.push(delayedAlert(delayed));
  if (group && group.packages?.length) alerts.push(assignAlert(group, now));
  if (noDriver.length) alerts.push(noDriverAlert(noDriver, now));
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_ALERTS);
};

/** Lee la base y arma los avisos del usuario. Nunca lanza por una consulta fallida: un aviso de menos no rompe nada. */
export const buildAlerts = async (user, db, now = Date.now()) => {
  if (!OPS.includes(user.role)) return [];
  const cols = 'id, route_code, origin, destination, departure_time, driver_id';
  const [plan, delayed, noDriver] = await Promise.all([
    loadAssignmentPlan(db, now).catch(() => ({ groups: [] })),
    db.from('transport_routes').select(cols).eq('status', 'planeada')
      .lt('departure_time', new Date(now - DELAY_GRACE_MS).toISOString()).gt('departure_time', new Date(now - DELAY_WINDOW_MS).toISOString())
      .order('departure_time', { ascending: true }).limit(20),
    db.from('transport_routes').select(cols).eq('status', 'planeada').is('driver_id', null)
      .gte('departure_time', new Date(now).toISOString()).lte('departure_time', new Date(now + NO_DRIVER_WINDOW_MS).toISOString())
      .order('departure_time', { ascending: true }).limit(20),
  ]);
  return planAlerts({ group: plan.groups?.[0] ?? null, delayed: delayed.data ?? [], noDriver: noDriver.data ?? [], now });
};
