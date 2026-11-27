import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import supabase from '../../shared/config/supabase.js';
import { haversineKm, statisticsService } from '../statistics/statistics.service.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from '../logistics/logistics.schema.js';
import { buildActionTools } from './ai-agent.actions.js';
import { buildAvailabilityTools } from './ai-agent.availability.js';
import { loadContacts } from './ai-agent.contacts.js';
import { similarNames } from './ai-agent.sound.js';
import { buildInsightTools } from './ai-agent.insights.js';
import { buildSuggestionTools } from './ai-agent.suggestions.js';
import { buildScreenTools } from './ai-agent.screen.js';
import { buildPlanTools } from './ai-agent.plan.js';

/**
 * Herramientas (tools) del agente. Son de SOLO LECTURA y se construyen por petición, con el usuario
 * autenticado, para aplicar el mismo control de acceso que la API REST:
 *   - cliente: solo sus propios paquetes; no consulta rutas ni listados operativos.
 *   - conductor: paquetes por código y solo las rutas que tiene asignadas (no busca por nombre de personas).
 *   - admin / operador logístico: acceso operativo completo.
 */
const MAX_LOGS = 15;
const MAX_ROUTES = 10;
const MAX_PEOPLE_RESULTS = 5;
const MIN_NAME_LENGTH = 3;
const OPERATIONS_ROLES = ['admin', 'logistics_operator'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const canAccessPackage = (user, pkg) => user.role !== 'client' || pkg.sender_id === user.id;

export const canAccessRoute = (user, route) =>
  OPERATIONS_ROLES.includes(user.role) || (user.role === 'driver' && route.driver_id === user.id);

// Deja solo letras, números, espacios, guion y apóstrofe: el nombre se inserta en un filtro de PostgREST
// (.or/.ilike), donde comas, paréntesis, puntos y comodines (% _) permitirían alterar la consulta.
export const sanitizeName = (name) =>
  String(name ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim();

const DENIED = 'No tienes permiso para consultar esa información.';

/**
 * La búsqueda por nombre no encontró nada: ¿habrá un nombre CONOCIDO que suene parecido («Kispe» → «Quispe»)? Solo se miran los contactos que
 * este rol ya puede ver (los de sus paquetes). Con un único nombre parecido se busca con él y se avisa; con varios se pregunta al usuario;
 * sin ninguno, el mensaje de siempre. Nunca devuelve datos de un nombre que el usuario no haya podido ver.
 */
const NOT_FOUND = 'No se encontró ningún paquete asociado a ese nombre.';
const suggestKnownName = async (user, db, typed, limit) => {
  try {
    const { recipients, senders } = await loadContacts(user, db);
    const names = similarNames(typed, [...recipients, ...senders].map((c) => c.name));
    if (names.length === 0) return NOT_FOUND;
    if (names.length > 1) return `${NOT_FOUND} ¿Se refiere a ${names.slice(0, 3).join(' o a ')}? Pregúntale al usuario cuál y vuelve a buscar con ese nombre.`;
    const clean = sanitizeName(names[0]);
    let q = db.from('packages').select('tracking_code, status, origen, destino, recipient_name, sender_name, created_at')
      .or(`recipient_name.ilike.%${clean}%,sender_name.ilike.%${clean}%`).order('created_at', { ascending: false }).limit(limit);
    if (user.role === 'client') q = q.eq('sender_id', user.id);
    const { data, error } = await q;
    if (error || !data?.length) return NOT_FOUND;
    return asText({ matches: data, note: `No había nadie llamado «${typed}»; estos son de «${names[0]}», que suena parecido. Dile al usuario que lo verifique.` });
  } catch {
    return NOT_FOUND; // la sugerencia es un extra: si falla, se responde como siempre
  }
};
const MAX_LIST = 8;

// Inicio del día de hoy en Bolivia (UTC-4), en ISO
export const startOfTodayBolivia = (now = Date.now()) => {
  const OFFSET = 4 * 60 * 60 * 1000;
  const d = new Date(now - OFFSET);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + OFFSET).toISOString();
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (n) => Math.round(n * 10) / 10;

// Un conductor solo ve los paquetes de sus propias rutas (el resto de roles se rige por canAccessPackage)
export const canDriverSeePackage = (user, route) => user.role !== 'driver' || Boolean(route && route.driver_id === user.id);

const ROUTE_SELECT =
  'id, route_code, origin, destination, status, departure_time, estimated_arrival, driver_id, vehicle_id, origin_lat, origin_lng, dest_lat, dest_lng';

/** Ruta del paquete con su conductor, vehículo y checkpoints (para responder "¿dónde está y quién lo lleva?"). */
const loadRouteContext = async (db, routeId) => {
  if (!routeId) return null;
  const { data: route } = await db.from('transport_routes').select(ROUTE_SELECT).eq('id', routeId).maybeSingle();
  if (!route) return null;
  const [driver, vehicle, checkpoints] = await Promise.all([
    route.driver_id ? db.from('drivers').select('full_name').eq('id', route.driver_id).maybeSingle() : { data: null },
    route.vehicle_id ? db.from('vehicles').select('plate, brand, model').eq('id', route.vehicle_id).maybeSingle() : { data: null },
    db.from('route_checkpoints').select('name, lat, lng, sequence_order').eq('route_id', routeId).order('sequence_order', { ascending: true }),
  ]);
  return { route, driver: driver?.data ?? null, vehicle: vehicle?.data ?? null, checkpoints: checkpoints?.data ?? [] };
};

/** Ubicación aproximada: última posición registrada, checkpoint más cercano y distancia al destino. */
export const describeLocation = (logs, ctx) => {
  const last = (logs || []).find((l) => isNum(l.lat) && isNum(l.lng) && !(l.lat === 0 && l.lng === 0));
  if (!last) return null;
  const nearest = (ctx?.checkpoints || [])
    .filter((c) => isNum(c.lat) && isNum(c.lng))
    .map((c) => ({ name: c.name, distance_km: round1(haversineKm(last.lat, last.lng, c.lat, c.lng)) }))
    .sort((a, b) => a.distance_km - b.distance_km)[0] ?? null;
  const r = ctx?.route;
  const kmToDestination = r && isNum(r.dest_lat) && isNum(r.dest_lng) ? round1(haversineKm(last.lat, last.lng, r.dest_lat, r.dest_lng)) : null;
  return { lat: last.lat, lng: last.lng, at: last.timestamp, last_event: last.status, nearest_checkpoint: nearest, km_to_destination: kmToDestination };
};

const publicPackage = (p) => ({
  tracking_code: p.tracking_code,
  status: p.status,
  origen: p.origen,
  destino: p.destino,
  recipient_name: p.recipient_name ?? null,
  created_at: p.created_at,
});
const asText = (value) => JSON.stringify(value);

export const buildTools = (user, db = supabase, statsService = statisticsService) => {
  const getPackageTracking = tool(
    async ({ code }) => {
      try {
        if (typeof code !== 'string' || code.trim().length < 3 || code.length > 64) return 'Indica un código de rastreo válido (empieza con TRK-).';
        const query = db
          .from('packages')
          .select('id, tracking_code, status, origen, destino, peso, route_id, sender_id, created_at, delivered_at, recipient_name');
        const { data: pkg, error } = await (UUID_RE.test(code) ? query.eq('id', code) : query.eq('tracking_code', code.trim())).maybeSingle();
        if (error) throw error;
        if (!pkg) return 'No se encontró ningún paquete con ese código.';
        if (!canAccessPackage(user, pkg)) return DENIED;

        const ctx = await loadRouteContext(db, pkg.route_id);
        if (!canDriverSeePackage(user, ctx?.route)) return DENIED;

        const { data: logs, error: logsError } = await db
          .from('tracking_logs')
          .select('status, timestamp, lat, lng, observations')
          .eq('package_id', pkg.id)
          .order('timestamp', { ascending: false })
          .limit(MAX_LOGS);
        if (logsError) throw logsError;

        const { sender_id, id, route_id, ...publicPkg } = pkg; // no se exponen identificadores internos
        const delivered = pkg.status === PACKAGE_STATUS.DELIVERED;
        const r = ctx?.route;
        return asText({
          kind: 'package_tracking',
          package: publicPkg,
          route: r
            ? {
                route_code: r.route_code,
                origin: r.origin,
                destination: r.destination,
                status: r.status,
                departure_time: r.departure_time,
                estimated_arrival: r.estimated_arrival,
                driver_name: ctx.driver?.full_name ?? null,
                vehicle: ctx.vehicle ? [ctx.vehicle.plate, ctx.vehicle.brand && !(ctx.vehicle.model ?? '').toLowerCase().startsWith(String(ctx.vehicle.brand).toLowerCase()) ? ctx.vehicle.brand : null, ctx.vehicle.model].filter(Boolean).join(' ') : null,
              }
            : null,
          // un paquete entregado ya no tiene "ubicación actual"
          location: delivered ? null : describeLocation(logs, ctx),
          timeline: (logs || []).map((l) => ({ status: l.status, at: l.timestamp, note: l.observations ?? null })),
        });
      } catch (e) {
        return `No se pudo consultar el paquete: ${e.message}`;
      }
    },
    {
      name: 'get_package_tracking',
      description:
        'Estado completo de un paquete a partir de su código de rastreo (TRK-...): estado, ruta, conductor y vehículo, hora estimada de llegada, ubicación aproximada (último punto GPS, checkpoint más cercano y km al destino) e historial de eventos. Úsala para "¿dónde está?", "¿en qué estado?", "¿cuándo llega?" y "¿quién lo lleva?".',
      // Esquemas JSON simples (sin format/min/max): los proveedores de LLM aceptan solo un subconjunto de JSON Schema.
      schema: z.object({
        code: z.string().describe('Código de rastreo del paquete (empieza con TRK-)'),
      }),
    }
  );

  const getRouteInfo = tool(
    async ({ routeCode, routeId }) => {
      try {
        if (!routeCode && !routeId) return 'Indica el código o el identificador de la ruta.';
        if (routeId && !UUID_RE.test(routeId)) return 'El identificador de la ruta no es válido.';
        if (routeCode && routeCode.length > 64) return 'El código de la ruta no es válido.';
        const query = db
          .from('transport_routes')
          .select('id, route_code, origin, destination, status, departure_time, driver_id, driver:drivers(full_name), packages(tracking_code, status)');
        const { data: route, error } = await (routeId ? query.eq('id', routeId) : query.eq('route_code', routeCode.trim())).maybeSingle();
        if (error) throw error;
        if (!route) return 'No se encontró esa ruta.';
        if (!canAccessRoute(user, route)) return DENIED;

        const { driver_id, ...publicRoute } = route;
        return asText(publicRoute);
      } catch (e) {
        return `No se pudo consultar la ruta: ${e.message}`;
      }
    },
    {
      name: 'get_route_info',
      description:
        'Obtiene los datos de una ruta de transporte (origen, destino, estado, salida, conductor) y los paquetes asignados, por su código de ruta o su identificador.',
      schema: z.object({
        routeCode: z.string().optional().describe('Código de la ruta (route_code)'),
        routeId: z.string().optional().describe('Identificador UUID de la ruta'),
      }),
    }
  );

  const listRoutes = tool(
    async ({ status }) => {
      try {
        if (!OPERATIONS_ROLES.includes(user.role)) return DENIED;
        let query = db
          .from('transport_routes')
          .select('route_code, origin, destination, status, departure_time')
          .order('departure_time', { ascending: false })
          .limit(MAX_ROUTES);
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) throw error;
        return asText(data || []);
      } catch (e) {
        return `No se pudo listar las rutas: ${e.message}`;
      }
    },
    {
      name: 'list_routes',
      description: `Lista las ${MAX_ROUTES} rutas más recientes, opcionalmente filtradas por estado. Solo para administradores y operadores logísticos.`,
      schema: z.object({
        status: z.enum(['planeada', 'en_transito', 'completada']).optional().describe('Estado de la ruta'),
      }),
    }
  );

  const findPackagesByPerson = tool(
    async ({ name }) => {
      try {
        if (user.role === 'driver') return DENIED;
        const safe = sanitizeName(name);
        if (safe.length < MIN_NAME_LENGTH) return `Indica al menos ${MIN_NAME_LENGTH} letras del nombre de la persona.`;

        let query = db
          .from('packages')
          .select('tracking_code, status, origen, destino, recipient_name, sender_name, created_at')
          .or(`recipient_name.ilike.%${safe}%,sender_name.ilike.%${safe}%`)
          .order('created_at', { ascending: false })
          .limit(MAX_PEOPLE_RESULTS);
        // Un cliente solo encuentra paquetes que él mismo envió (filtro en la consulta, no después)
        if (user.role === 'client') query = query.eq('sender_id', user.id);

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) return suggestKnownName(user, db, safe, MAX_PEOPLE_RESULTS);
        return asText({ matches: data, note: data.length === MAX_PEOPLE_RESULTS ? 'Se muestran los más recientes; pide más datos si no es el correcto.' : undefined });
      } catch (e) {
        return `No se pudo buscar por nombre: ${e.message}`;
      }
    },
    {
      name: 'find_packages_by_person',
      description:
        'Busca paquetes por el nombre del destinatario o del remitente cuando el usuario no conoce el código de rastreo (ej. "mi caja a nombre de Juan Pérez"). Devuelve hasta 5 coincidencias con su código y estado. Si hay varias, pide al usuario que confirme cuál es.',
      schema: z.object({
        name: z.string().describe('Nombre o apellido de la persona (mínimo 3 letras)'),
      }),
    }
  );

  const listMyPackages = tool(
    async ({ status }) => {
      try {
        let query = db
          .from('packages')
          .select('tracking_code, status, origen, destino, recipient_name, created_at, route_id')
          .order('created_at', { ascending: false })
          .limit(MAX_LIST);
        if (status) query = query.eq('status', status);

        if (user.role === 'client') {
          query = query.eq('sender_id', user.id);
        } else if (user.role === 'driver') {
          const { data: mine } = await db.from('transport_routes').select('id').eq('driver_id', user.id);
          const ids = (mine || []).map((r) => r.id);
          if (ids.length === 0) return asText({ kind: 'package_list', title: 'Paquetes de tus rutas', packages: [] });
          query = query.in('route_id', ids);
        }
        const { data, error } = await query;
        if (error) throw error;
        const title = user.role === 'client' ? 'Tus paquetes' : user.role === 'driver' ? 'Paquetes de tus rutas' : 'Paquetes recientes';
        return asText({ kind: 'package_list', title, packages: (data || []).map(publicPackage) });
      } catch (e) {
        return `No se pudo listar los paquetes: ${e.message}`;
      }
    },
    {
      name: 'list_my_packages',
      description: `Lista hasta ${MAX_LIST} paquetes recientes: los del cliente que consulta, los de las rutas del conductor, o todos para administradores y operadores. Opcionalmente filtra por estado. Úsala para "¿qué paquetes tengo?", "¿cuáles están en tránsito?" o "¿tengo algo entregado?".`,
      schema: z.object({
        status: z.enum(['pendiente', 'asignado', 'en_transito', 'en_agencia', 'entregado', 'siniestro', 'devuelto', 'cancelado']).optional().describe('Filtrar por estado'),
      }),
    }
  );

  const getOperationsSummary = tool(
    async () => {
      try {
        if (!OPERATIONS_ROLES.includes(user.role)) return DENIED;
        const s = await statsService.getDashboardStats();
        return asText({
          kind: 'operations_summary',
          packages_today: s.packagesToday,
          in_transit: s.packagesInTransit,
          pending: s.packagesPending,
          delayed: s.packagesDelayed,
          incidents: s.packagesIncident,
          at_agency: s.packagesAtAgency,
          active_routes: s.activeRoutes,
          vehicles: s.totalVehicles,
          drivers: s.totalDrivers,
          delivery_rate_pct: s.sla,
        });
      } catch (e) {
        return `No se pudo obtener el resumen: ${e.message}`;
      }
    },
    {
      name: 'get_operations_summary',
      description: 'Resumen de la operación de hoy: paquetes en tránsito, pendientes, retrasados, siniestros, rutas activas, flota y tasa de entrega. Solo administradores y operadores. Úsala para "¿cómo va la operación?" o "¿hay problemas?".',
      schema: z.object({}),
    }
  );

  const listPackagesNeedingAttention = tool(
    async () => {
      try {
        if (!OPERATIONS_ROLES.includes(user.role)) return DENIED;
        const cols = 'tracking_code, status, origen, destino, recipient_name, created_at';
        const [incidents, delayed] = await Promise.all([
          db.from('packages').select(cols).eq('status', PACKAGE_STATUS.INCIDENT).order('created_at', { ascending: false }).limit(MAX_LIST),
          db
            .from('packages')
            .select(`${cols}, transport_routes!inner(departure_time)`)
            .eq('status', PACKAGE_STATUS.ASSIGNED)
            .lt('transport_routes.departure_time', new Date().toISOString())
            .limit(MAX_LIST),
        ]);
        if (incidents.error) throw incidents.error;
        if (delayed.error) throw delayed.error;
        const items = [
          ...(incidents.data || []).map((p) => ({ ...publicPackage(p), reason: 'siniestro' })),
          ...(delayed.data || []).map((p) => ({ ...publicPackage(p), reason: 'retrasado: su ruta ya debió salir' })),
        ];
        return asText({ kind: 'package_list', title: 'Requieren atención', packages: items });
      } catch (e) {
        return `No se pudo consultar los paquetes con problemas: ${e.message}`;
      }
    },
    {
      name: 'list_packages_needing_attention',
      description: 'Lista los paquetes con siniestro y los retrasados (asignados a una ruta que ya debió salir). Solo administradores y operadores. Úsala para "¿qué tengo que atender?", "¿hay paquetes con problemas?" o "¿qué está retrasado?".',
      schema: z.object({}),
    }
  );

  const getMyDeliveries = tool(
    async () => {
      try {
        if (user.role !== 'driver') return 'Esta consulta es solo para conductores.';
        // Rutas en curso (salieron cuando salieron) y planeadas desde hoy: las planeadas de fechas pasadas que nunca
        // se completaron no son "próximas" y confundirían la agenda.
        const cols = 'id, route_code, origin, destination, status, departure_time, estimated_arrival';
        const mine = () => db.from('transport_routes').select(cols).eq('driver_id', user.id).order('departure_time', { ascending: true }).limit(5);
        const [active, planned] = await Promise.all([
          mine().eq('status', ROUTE_STATUS.ACTIVE),
          mine().eq('status', ROUTE_STATUS.PLANNED).gte('departure_time', startOfTodayBolivia()),
        ]);
        if (active.error) throw active.error;
        if (planned.error) throw planned.error;
        const routes = [...(active.data || []), ...(planned.data || [])].slice(0, 5);
        const out = [];
        for (const r of routes || []) {
          const { data: pk } = await db.from('packages').select('tracking_code, status, destino, recipient_name').eq('route_id', r.id).limit(MAX_LIST);
          const { id, ...route } = r;
          out.push({ ...route, packages: pk || [] });
        }
        return asText({ kind: 'driver_agenda', routes: out });
      } catch (e) {
        return `No se pudo consultar tu agenda: ${e.message}`;
      }
    },
    {
      name: 'get_my_deliveries',
      description: 'Agenda del conductor: sus próximas rutas (planeadas o en curso) con los paquetes que debe entregar. Solo conductores. Úsala para "¿qué entregas tengo hoy?" o "¿cuál es mi próxima ruta?".',
      schema: z.object({}),
    }
  );

  const getFleetStatus = tool(
    async () => {
      try {
        if (user.role !== 'admin') return DENIED;
        const [vehicles, drivers] = await Promise.all([
          db.from('vehicles').select('plate, brand, model, type, capacity_kg, status').limit(20),
          db.from('drivers').select('full_name, status').limit(20),
        ]);
        if (vehicles.error) throw vehicles.error;
        if (drivers.error) throw drivers.error;
        return asText({ kind: 'fleet_status', vehicles: vehicles.data || [], drivers: drivers.data || [] });
      } catch (e) {
        return `No se pudo consultar la flota: ${e.message}`;
      }
    },
    {
      name: 'get_fleet_status',
      description: 'Estado de la flota: vehículos (placa, tipo, capacidad, estado) y conductores. Solo administradores. Úsala para "¿qué vehículos hay disponibles?" o "¿cuántos conductores tengo?".',
      schema: z.object({}),
    }
  );

  return [getPackageTracking, findPackagesByPerson, listMyPackages, getOperationsSummary, listPackagesNeedingAttention, getMyDeliveries, getFleetStatus, getRouteInfo, listRoutes, ...buildAvailabilityTools(user, db), ...buildInsightTools(user, db, statsService), ...buildSuggestionTools(user, db), ...buildActionTools(user, db), ...buildScreenTools(user), ...buildPlanTools(user, db)];
};

const TOOLS_BY_ROLE = {
  client: ['get_package_tracking', 'find_packages_by_person', 'list_my_packages', 'find_available_trips', 'show_on_screen'], // el cliente solo consulta
  driver: ['get_package_tracking', 'list_my_packages', 'get_my_deliveries', 'get_route_info', 'find_available_trips', 'propose_deliver_package', 'show_on_screen'],
  logistics_operator: ['get_package_tracking', 'find_packages_by_person', 'list_my_packages', 'get_operations_summary', 'list_packages_needing_attention', 'get_route_info', 'list_routes', 'find_available_trips', 'check_fleet_availability', 'get_daily_briefing', 'get_analytics_summary', 'suggest_assignments', 'propose_register_event', 'propose_deliver_package', 'propose_create_package', 'propose_assign_package', 'propose_cancel_package', 'propose_assign_driver', 'propose_create_trip', 'propose_reschedule_trip', 'propose_cancel_trip', 'propose_plan', 'show_on_screen'],
  admin: ['get_package_tracking', 'find_packages_by_person', 'list_my_packages', 'get_operations_summary', 'list_packages_needing_attention', 'get_fleet_status', 'get_route_info', 'list_routes', 'find_available_trips', 'check_fleet_availability', 'get_daily_briefing', 'get_analytics_summary', 'suggest_assignments', 'propose_register_event', 'propose_deliver_package', 'propose_create_package', 'propose_assign_package', 'propose_cancel_package', 'propose_assign_driver', 'propose_create_trip', 'propose_reschedule_trip', 'propose_cancel_trip', 'propose_create_vehicle', 'propose_update_vehicle', 'propose_plan', 'show_on_screen'],
};

/** Solo las herramientas que el rol puede usar: el modelo no pierde pasos intentando las prohibidas. */
export const toolsForUser = (user, db = supabase, statsService = statisticsService) => {
  const allowed = TOOLS_BY_ROLE[user?.role] ?? TOOLS_BY_ROLE.client;
  return buildTools(user, db, statsService).filter((tl) => allowed.includes(tl.name));
};

const ATTACHMENT_KINDS = new Set(['package_tracking', 'assignment_suggestions', 'package_list', 'operations_summary', 'driver_agenda', 'fleet_status', 'ui_command', 'action_proposal', 'available_trips', 'fleet_availability', 'daily_briefing', 'analytics_summary']);
const MAX_ATTACHMENTS = 3;

/** Datos estructurados que las herramientas devolvieron en este turno, para dibujarlos como tarjetas en el chat. */
export const extractAttachments = (messages = []) => {
  const out = [];
  for (const m of messages) {
    const type = m?.type ?? m?._getType?.();
    if (type !== 'tool' || typeof m.content !== 'string') continue;
    try {
      const data = JSON.parse(m.content);
      if (data && ATTACHMENT_KINDS.has(data.kind)) out.push(data);
    } catch {
      /* la herramienta devolvió texto (error o aviso): no hay tarjeta */
    }
  }
  return out.slice(-MAX_ATTACHMENTS);
};
