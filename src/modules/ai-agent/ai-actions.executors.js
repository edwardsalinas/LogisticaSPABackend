import supabase from '../../shared/config/supabase.js';
import * as TrackingService from '../tracking/tracking.service.js';
import * as LogisticsService from '../logistics/logistics.service.js';
import { PACKAGE_STATUS } from '../logistics/logistics.schema.js';
import { checkRouteForPackage } from './ai-agent.actions.js';
import { applyAssignDriver } from './ai-agent.fleet-actions.js';
import { applyCancelTrip, applyCreateVehicle, applyDeleteVehicle, applyRescheduleTrip, applyUpdatePackage, applyUpdateVehicle, undoRescheduleTrip, undoUpdatePackage, undoUpdateVehicle } from './ai-agent.manage-actions.js';
import { createVehicle } from '../fleet/fleet.service.js';
import { applyPlan } from './ai-agent.plan.js';

/**
 * Qué hace cada acción al confirmarse. Reutiliza los MISMOS servicios que la API REST y la interfaz clásica,
 * así que se aplican las mismas reglas (estados finales, un conductor solo entrega paquetes de sus rutas,
 * responsable registrado en el historial, etc.). `user` es siempre el usuario autenticado que confirmó.
 *
 * Con varios paquetes, cada uno se procesa por separado: si uno falla, los demás siguen y el resultado dice
 * cuáles se hicieron y cuáles no (no hay "todo o nada": cada paquete es independiente).
 */
const STATUS_LABELS = { en_transito: 'En tránsito', en_agencia: 'En agencia', siniestro: 'Siniestro' };
const ASSIGNABLE = [PACKAGE_STATUS.PENDING, PACKAGE_STATUS.ASSIGNED];

const reasonOf = (error) => (error?.status && error.status < 500 ? error.message : 'no se pudo completar');

/** Ejecuta `fn` por cada elemento y devuelve [{ tracking_code, ok, error? }]. */
export const runBatch = async (items, fn) => {
  const results = [];
  const errors = [];
  for (const item of items) {
    try {
      await fn(item);
      results.push({ tracking_code: item.tracking_code, ok: true });
    } catch (error) {
      errors.push(error);
      console.error(`[AI Action] ${item.tracking_code}:`, error.message);
      results.push({ tracking_code: item.tracking_code, ok: false, error: reasonOf(error) });
    }
  }
  return { results, errors };
};

/**
 * Resultado final. Un solo paquete: mensaje de siempre y, si falla, el error original (con su código HTTP).
 * Varios: resumen "N de M" con lo que falló; si no se hizo ninguno, es un error.
 */
export const summarize = ({ results, errors }, { one, many }) => {
  if (results.length === 1) {
    if (!results[0].ok) throw errors[0];
    return { message: one(results[0].tracking_code), data: { results } };
  }
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  if (ok.length === 0) {
    throw Object.assign(new Error(`No se pudo hacer ninguno: ${failed.map((r) => `${r.tracking_code} (${r.error})`).join('; ')}`), { status: 409 });
  }
  const tail = failed.length ? ` No se pudo con: ${failed.map((r) => `${r.tracking_code} (${r.error})`).join('; ')}.` : '';
  return { message: `${many(ok.length, results.length)}${tail}`, data: { results } };
};

const rawExecutors = {
  async register_tracking_event(p, user) {
    const outcome = await runBatch(p.items, (item) =>
      TrackingService.logEvent({ package_id: item.package_id, lat: item.lat, lng: item.lng, status: p.status, observations: p.observations }, user)
    );
    const label = STATUS_LABELS[p.status] ?? p.status;
    return summarize(outcome, {
      one: (code) => `Evento "${label}" registrado para ${code}.`,
      many: (n, total) => `Evento "${label}" registrado en ${n} de ${total} paquetes.`,
    });
  },

  async deliver_package(p, user) {
    const outcome = await runBatch(p.items, (item) => LogisticsService.deliverPackage(item.package_id, { user, note: p.note }));
    return summarize(outcome, {
      one: (code) => `Paquete ${code} marcado como entregado.`,
      many: (n, total) => `Entregados ${n} de ${total} paquetes.`,
    });
  },

  async create_package(p, user) {
    const created = await LogisticsService.createPackage(p.data, user.id, { actor: user });
    const where = p.data.route_id ? ' y agendado en el viaje elegido' : '';
    return { message: `Paquete creado con el código ${created.tracking_code}${where}.`, data: { tracking_code: created.tracking_code } };
  },

  async assign_package(p, user) {
    // Se vuelve a comprobar AHORA: entre proponer y confirmar el viaje pudo llenarse o iniciar
    const totalKg = p.items.reduce((s, i) => s + (i.peso || 0), 0);
    const check = await checkRouteForPackage(supabase, p.route_id, totalKg);
    if (check.error) throw Object.assign(new Error(check.error), { status: 409 });

    const outcome = await runBatch(p.items, async (item) => {
      const { data: current } = await supabase.from('packages').select('status').eq('id', item.package_id).maybeSingle();
      if (!current || !ASSIGNABLE.includes(current.status)) {
        throw Object.assign(new Error('ya no se puede asignar (cambió de estado)'), { status: 409 });
      }
      await LogisticsService.assignPackageToRoute(item.package_id, p.route_id, { actor: user });
    });
    return summarize(outcome, {
      one: (code) => `Paquete ${code} asignado al viaje.`,
      many: (n, total) => `Asignados ${n} de ${total} paquetes al viaje.`,
    });
  },

  // Anular: el mismo servicio que «Deshacer» la creación (solo paquetes pendientes, sin viaje y recientes)
  async cancel_package(p, user) {
    const outcome = await runBatch(p.items, (item) => LogisticsService.cancelNewPackage(item.package_id, { actor: user }));
    return summarize(outcome, {
      one: (code) => `Paquete ${code} anulado.`,
      many: (n, total) => `Anulados ${n} de ${total} paquetes.`,
    });
  },

  async assign_driver(p, _user) {
    return applyAssignDriver(supabase, p);
  },

  async create_trip(p, _user) {
    const route = await LogisticsService.createRoute(p.route);
    return { message: 'Viaje creado.', data: { route_id: route?.id ?? route?.route?.id ?? null } };
  },

  async reschedule_trip(p, _user) {
    return applyRescheduleTrip(supabase, p);
  },

  async cancel_trip(p, _user) {
    return applyCancelTrip(supabase, p, (id) => LogisticsService.deleteRoute(id));
  },

  async create_vehicle(p, _user) {
    return applyCreateVehicle(supabase, p, createVehicle);
  },

  async update_vehicle(p, _user) {
    return applyUpdateVehicle(supabase, p);
  },

  async delete_vehicle(p, _user) {
    return applyDeleteVehicle(supabase, p);
  },

  async update_package(p, _user) {
    return applyUpdatePackage(supabase, p);
  },

  // varios pasos con una confirmación: cada uno se vuelve a preparar y confirmar con las reglas de siempre
  async plan(p, user) {
    return applyPlan(p, user, supabase, defaultExecutors);
  },
};

/**
 * Recibo verificable: DESPUÉS de ejecutar, vuelve a leer de la base los paquetes tocados y devuelve su estado real
 * (no lo que dijo el modelo ni lo que el ejecutor creyó hacer). La interfaz lo muestra con un enlace a la ficha.
 * Si la lectura falla, no se pierde el resultado de la acción: simplemente no hay recibo.
 */
export const buildReceipt = async (codes, db = supabase) => {
  const list = [...new Set(codes.filter(Boolean))];
  if (list.length === 0) return [];
  const { data, error } = await db
    .from('packages')
    .select('id, tracking_code, status, origen, destino, peso, recipient_name, route_id')
    .in('tracking_code', list);
  if (error || !data) return [];

  const routeIds = [...new Set(data.map((p) => p.route_id).filter(Boolean))];
  let routes = {};
  if (routeIds.length) {
    const { data: rows } = await db.from('transport_routes').select('id, origin, destination').in('id', routeIds);
    routes = Object.fromEntries((rows ?? []).map((r) => [r.id, `${r.origin} → ${r.destination}`]));
  }
  return data.map((p) => ({
    id: p.id,
    tracking_code: p.tracking_code,
    status: p.status,
    origen: p.origen,
    destino: p.destino,
    peso: p.peso,
    recipient_name: p.recipient_name,
    trip: p.route_id ? routes[p.route_id] ?? null : null,
  }));
};

const withReceipt = (fn) => async (params, user) => {
  const result = await fn(params, user);
  const codes = [
    result.data?.tracking_code,
    ...(result.data?.results ?? []).filter((r) => r.ok).map((r) => r.tracking_code),
  ];
  try {
    const records = await buildReceipt(codes);
    if (records.length) result.data = { ...(result.data ?? {}), records };
  } catch (error) {
    console.error('[AI Action] no se pudo armar el recibo:', error.message);
  }
  return result;
};

/** Cómo se devuelve cada acción que se puede devolver (el servidor guardó cómo estaba). */
export const undoExecutors = {
  reschedule_trip: (u) => undoRescheduleTrip(supabase, u),
  update_vehicle: (u) => undoUpdateVehicle(supabase, u),
  update_package: (u) => undoUpdatePackage(supabase, u),
};

/** Solo para pruebas: los ejecutores sin envolver. */
export const _rawExecutors = rawExecutors;
export const defaultExecutors = Object.fromEntries(Object.entries(rawExecutors).map(([k, fn]) => [k, withReceipt(fn)]));
