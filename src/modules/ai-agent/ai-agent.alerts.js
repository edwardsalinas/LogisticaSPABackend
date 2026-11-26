import { createHash } from 'node:crypto';
import { loadAssignmentPlan } from './ai-agent.suggestions.js';

/**
 * Avisos proactivos de Logi: excepciones reales de la operación, calculadas por el servidor (reglas fijas, SIN modelo de
 * IA: no gastan consultas ni inventan nada). Cada aviso trae una acción posible y un identificador estable para que la
 * pantalla no repita el mismo aviso. Cada rol recibe los suyos: el personal, las excepciones de la operación; el cliente, lo que le
 * pasa a SUS paquetes; el conductor, lo que le toca de SUS viajes.
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

// ============================================================ cliente: lo que le pasa a SUS paquetes
const CLIENT_WINDOW_MS = 24 * HOUR_MS; // un estado de hace más de un día ya no es noticia
const MAX_CODES_SHOWN = 2;
const codesText = (list) => {
  const codes = list.map((p) => p.tracking_code);
  return codes.length <= MAX_CODES_SHOWN ? codes.join(' y ') : `${codes.slice(0, MAX_CODES_SHOWN).join(', ')} y ${codes.length - MAX_CODES_SHOWN} más`;
};
const detailOf = (p) => ({ kind: 'navigate', to: `/logistics/packages/${p.id}`, label: 'Ver el paquete' });
const listOf = { kind: 'navigate', to: '/logistics/packages', label: 'Ver mis paquetes' };
const idOf = (list) => shortId(list.map((p) => `${p.id}`).sort().join(','));

/**
 * Avisos del cliente a partir de sus paquetes ya leídos (función pura). `packages` trae { id, tracking_code, status, origen, destino,
 * delivered_at } y `lastEventAt` el momento del último movimiento de cada uno (por id). Solo lo reciente: entregado, en tránsito,
 * en agencia o con siniestro en las últimas 24 horas. Un cambio de estado es un aviso NUEVO (el id incluye el estado).
 */
export const planClientAlerts = ({ packages = [], lastEventAt = {}, now = Date.now() } = {}) => {
  const fresh = (iso) => iso && now - Date.parse(iso) <= CLIENT_WINDOW_MS && Date.parse(iso) <= now + HOUR_MS;
  const by = (status) => packages.filter((p) => p.status === status && fresh(status === 'entregado' ? p.delivered_at : lastEventAt[p.id]));
  const alerts = [];

  const incidents = by('siniestro');
  if (incidents.length) {
    const first = incidents[0];
    alerts.push({
      id: `client_incident:${idOf(incidents)}`,
      type: 'client_incident', severity: 'high',
      title: 'Hubo un problema con tu paquete',
      text: `${incidents.length === 1 ? `El paquete ${first.tracking_code}` : `Los paquetes ${codesText(incidents)}`} ${incidents.length === 1 ? 'reportó' : 'reportaron'} un siniestro. Revisa su estado y comunícate con la empresa.`,
      action: incidents.length === 1 ? detailOf(first) : listOf,
    });
  }

  const delivered = by('entregado');
  if (delivered.length) {
    const first = delivered[0];
    alerts.push({
      id: `client_delivered:${idOf(delivered)}`,
      type: 'client_delivered', severity: 'info',
      title: delivered.length === 1 ? '¡Tu paquete llegó!' : '¡Tus paquetes llegaron!',
      text: delivered.length === 1
        ? `El paquete ${first.tracking_code} (de ${first.origen} a ${first.destino}) ya fue entregado.`
        : `${delivered.length} de tus paquetes ya fueron entregados (${codesText(delivered)}).`,
      action: delivered.length === 1 ? detailOf(first) : listOf,
    });
  }

  const moving = by('en_transito');
  if (moving.length) {
    const first = moving[0];
    alerts.push({
      id: `client_in_transit:${idOf(moving)}`,
      type: 'client_in_transit', severity: 'info',
      title: moving.length === 1 ? 'Tu paquete va en camino' : 'Tus paquetes van en camino',
      text: moving.length === 1
        ? `El paquete ${first.tracking_code} salió de ${first.origen} rumbo a ${first.destino}.`
        : `${moving.length} de tus paquetes ya salieron (${codesText(moving)}).`,
      action: moving.length === 1 ? { kind: 'navigate', to: `/tracking/${first.id}/map`, label: 'Ver dónde va' } : { kind: 'navigate', to: '/tracking', label: 'Ver el seguimiento' },
    });
  }

  const agency = by('en_agencia');
  if (agency.length) {
    const first = agency[0];
    alerts.push({
      id: `client_in_agency:${idOf(agency)}`,
      type: 'client_in_agency', severity: 'info',
      title: agency.length === 1 ? 'Tu paquete está en la agencia' : 'Tus paquetes están en la agencia',
      text: agency.length === 1 ? `El paquete ${first.tracking_code} llegó a la agencia de ${first.destino}.` : `${agency.length} de tus paquetes llegaron a la agencia (${codesText(agency)}).`,
      action: agency.length === 1 ? detailOf(first) : listOf,
    });
  }
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_ALERTS);
};

/** Lee los paquetes del cliente y arma sus avisos. Solo mira SUS paquetes (el filtro va en la consulta, no después). */
export const buildClientAlerts = async (user, db, now = Date.now()) => {
  const { data: packages } = await db.from('packages')
    .select('id, tracking_code, status, origen, destino, delivered_at')
    .eq('sender_id', user.id).in('status', ['en_transito', 'en_agencia', 'siniestro', 'entregado'])
    .order('created_at', { ascending: false }).limit(30);
  const list = packages ?? [];
  if (!list.length) return [];
  const ids = list.filter((p) => p.status !== 'entregado').map((p) => p.id);
  const lastEventAt = {};
  if (ids.length) {
    const { data: logs } = await db.from('tracking_logs').select('package_id, timestamp').in('package_id', ids).order('timestamp', { ascending: false }).limit(200);
    for (const l of logs ?? []) if (!lastEventAt[l.package_id] || Date.parse(l.timestamp) > Date.parse(lastEventAt[l.package_id])) lastEventAt[l.package_id] = l.timestamp;
  }
  return planClientAlerts({ packages: list, lastEventAt, now });
};

// ============================================================ conductor: lo que le toca de SUS viajes
const DRIVER_SOON_MS = 90 * 60 * 1000; // el viaje sale en la próxima hora y media
const DRIVER_LATE_MS = 60 * 60 * 1000; // y se avisa hasta una hora después de su hora

/**
 * Avisos del conductor a partir de sus viajes (función pura). `routes` trae { id, origin, destination, departure_time, status } y
 * `loads` { [routeId]: { total, pending } } los paquetes cargados y los que faltan por entregar.
 */
export const planDriverAlerts = ({ routes = [], loads = {}, now = Date.now() } = {}) => {
  const alerts = [];
  for (const r of routes) {
    const load = loads[r.id] ?? { total: 0, pending: 0 };
    const trip = `${r.origin} a ${r.destination}`;
    if (r.status === 'planeada' && r.departure_time) {
      const diff = Date.parse(r.departure_time) - now;
      if (diff <= DRIVER_SOON_MS && diff >= -DRIVER_LATE_MS) {
        const late = diff < 0;
        alerts.push({
          id: `driver_depart:${shortId(r.id)}`,
          type: 'driver_depart', severity: late ? 'high' : 'medium',
          title: late ? 'Tu viaje debería haber salido' : 'Tu viaje sale pronto',
          text: `El viaje de ${trip} ${late ? 'estaba previsto' : 'sale'} ${dayLabel(r.departure_time, now)} a las ${timeLabel(r.departure_time)}${load.total ? ` con ${plural(load.total, 'paquete cargado', 'paquetes cargados')}` : ''}.`,
          action: { kind: 'navigate', to: '/driver', label: 'Ver mi viaje' },
        });
      }
    } else if (r.status === 'en_transito' && load.pending > 0) {
      alerts.push({
        id: `driver_pending:${shortId(`${r.id}:${load.pending}`)}`,
        type: 'driver_pending', severity: 'info',
        title: 'Tienes entregas pendientes',
        text: `Te ${load.pending === 1 ? 'queda' : 'quedan'} ${plural(load.pending, 'entrega', 'entregas')} en el viaje de ${trip}.`,
        action: { kind: 'navigate', to: '/driver', label: 'Ver mis entregas' },
      });
    }
  }
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_ALERTS);
};

/** Lee los viajes del conductor y los paquetes que lleva. Solo SUS viajes (el filtro va en la consulta). */
export const buildDriverAlerts = async (user, db, now = Date.now()) => {
  // La ventana de tiempo va EN LA CONSULTA: un conductor acumula muchos viajes planeados antiguos y con «los 10 más viejos» el que sale
  // en 45 minutos quedaba fuera. Los planeados, solo los que salen pronto (o salieron hace poco); los en tránsito, los más recientes.
  const cols = 'id, origin, destination, departure_time, status';
  const [planned, moving] = await Promise.all([
    db.from('transport_routes').select(cols).eq('driver_id', user.id).eq('status', 'planeada')
      .gte('departure_time', new Date(now - DRIVER_LATE_MS).toISOString()).lte('departure_time', new Date(now + DRIVER_SOON_MS).toISOString())
      .order('departure_time', { ascending: true }).limit(5),
    db.from('transport_routes').select(cols).eq('driver_id', user.id).eq('status', 'en_transito')
      .order('departure_time', { ascending: false }).limit(5),
  ]);
  const list = [...(planned.data ?? []), ...(moving.data ?? [])];
  if (!list.length) return [];
  const { data: pkgs } = await db.from('packages').select('route_id, status').in('route_id', list.map((r) => r.id));
  const loads = {};
  for (const p of pkgs ?? []) {
    const l = (loads[p.route_id] ??= { total: 0, pending: 0 });
    l.total += 1;
    if (p.status !== 'entregado') l.pending += 1;
  }
  return planDriverAlerts({ routes: list, loads, now });
};

/** Lee la base y arma los avisos del usuario. Nunca lanza por una consulta fallida: un aviso de menos no rompe nada. */
export const buildAlerts = async (user, db, now = Date.now()) => {
  if (user.role === 'client') return buildClientAlerts(user, db, now).catch(() => []);
  if (user.role === 'driver') return buildDriverAlerts(user, db, now).catch(() => []);
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
