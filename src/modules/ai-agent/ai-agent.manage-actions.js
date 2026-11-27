import { createProposal } from './ai-actions.service.js';
import { proposalResult } from './ai-proposal-result.js';
import { parseWindow } from './ai-agent.availability.js';
import { ROUTE_STATUS } from '../logistics/logistics.schema.js';
import { VEHICLE_STATUS, vehicleSchema } from '../fleet/fleet.schema.js';

/**
 * Gestión de viajes y vehículos con confirmación: reprogramar un viaje, cancelar un viaje planeado, crear un vehículo y cambiar el
 * estado de un vehículo (incluido retirarlo). Igual que las demás acciones, estas funciones NO modifican nada: validan permisos y
 * estado, y devuelven una propuesta que el usuario confirma. Al confirmar, los ejecutores vuelven a comprobar el estado.
 *
 * Los vehículos no se borran: se «retiran» (el historial de viajes los sigue necesitando). Los conductores no se crean aquí: cada
 * uno es una cuenta de usuario y esa cuenta se crea al registrarse.
 */
const OPS = ['admin', 'logistics_operator'];
const DENIED = 'No tienes permiso para realizar esa acción.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_LEAD_MS = 5 * 60 * 1000;
const clean = (s) => String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim();
const whenText = (iso) => new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const tripName = (r) => `${r.origin} → ${r.destination}, sale ${whenText(r.departure_time)}`;
const failed = (e) => `No se pudo preparar la acción: ${e.message}`;
const httpError = (status, message) => Object.assign(new Error(message), { status });

const findTrip = async (db, routeRef) => {
  const ref = String(routeRef ?? '').trim();
  if (!ref) return null;
  const q = db.from('transport_routes').select('id, route_code, origin, destination, status, departure_time, estimated_arrival, driver_id, vehicle_id');
  const { data } = await (UUID_RE.test(ref) ? q.eq('id', ref) : q.eq('route_code', ref)).maybeSingle();
  return data ?? null;
};
const packagesOn = async (db, routeId) => {
  const { count } = await db.from('packages').select('id', { count: 'exact', head: true }).eq('route_id', routeId);
  return count ?? 0;
};

// ============================================================ reprogramar un viaje
export const prepareRescheduleProposal = async (user, db, { route_ref, date, time }, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const route = await findTrip(db, route_ref);
    if (!route) return 'No encontré ese viaje. Pídele al usuario que elija uno de los que mostró la disponibilidad.';
    if (route.status !== ROUTE_STATUS.PLANNED) return 'Ese viaje ya no está planeado (ya salió o terminó): no se puede reprogramar.';
    const win = parseWindow({ date, from_time: time, to_time: time });
    if (win.error) return win.error;
    if (win.start < now + MIN_LEAD_MS) return 'La nueva fecha y hora ya pasaron. Indica una salida futura.';
    const departure = new Date(win.start).toISOString();
    if (Math.abs(Date.parse(route.departure_time) - win.start) < 60 * 1000) return 'Ese viaje ya sale a esa hora.';
    const onBoard = await packagesOn(db, route.id);
    const proposal = createProposal({
      user,
      type: 'reschedule_trip',
      params: { route_id: route.id, departure_time: departure, items: [] },
      title: 'Reprogramar un viaje',
      lines: [
        `Viaje: ${route.origin} → ${route.destination}`,
        `Sale ahora: ${whenText(route.departure_time)}`,
        `Saldrá: ${whenText(departure)}`,
        ...(onBoard ? [`Aviso: lleva ${onBoard} ${onBoard === 1 ? 'paquete asignado' : 'paquetes asignados'}; sus destinatarios verán la nueva hora`] : []),
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

export const applyRescheduleTrip = async (db, p) => {
  const { data: route } = await db.from('transport_routes').select('id, status, departure_time, estimated_arrival').eq('id', p.route_id).maybeSingle();
  if (!route) throw httpError(404, 'No se encontró el viaje.');
  if (route.status !== ROUTE_STATUS.PLANNED) throw httpError(409, 'El viaje ya no está planeado (ya salió o terminó).');
  const shift = Date.parse(p.departure_time) - Date.parse(route.departure_time);
  const patch = { departure_time: p.departure_time, updated_at: new Date().toISOString() };
  if (route.estimated_arrival) patch.estimated_arrival = new Date(Date.parse(route.estimated_arrival) + shift).toISOString(); // la llegada se corre lo mismo
  const { error } = await db.from('transport_routes').update(patch).eq('id', p.route_id).eq('status', ROUTE_STATUS.PLANNED);
  if (error) throw error;
  return { message: 'Viaje reprogramado.', data: { route_id: p.route_id } };
};

// ============================================================ cancelar un viaje planeado
export const prepareCancelTripProposal = async (user, db, { route_ref }, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const route = await findTrip(db, route_ref);
    if (!route) return 'No encontré ese viaje. Pídele al usuario que elija uno de los que mostró la disponibilidad.';
    if (route.status !== ROUTE_STATUS.PLANNED) return 'Solo se pueden cancelar viajes planeados: ese ya salió o terminó.';
    const onBoard = await packagesOn(db, route.id);
    const proposal = createProposal({
      user,
      type: 'cancel_trip',
      params: { route_id: route.id, items: [] },
      title: 'Cancelar un viaje',
      lines: [
        `Viaje: ${tripName(route)}`,
        onBoard
          ? `Aviso: tiene ${onBoard} ${onBoard === 1 ? 'paquete asignado, que volverá' : 'paquetes asignados, que volverán'} a «pendiente» para asignarse a otro viaje`
          : 'No tiene paquetes asignados.',
        'El viaje se elimina y no se puede deshacer.',
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

export const applyCancelTrip = async (db, p, deleteRoute) => {
  const { data: route } = await db.from('transport_routes').select('id, status').eq('id', p.route_id).maybeSingle();
  if (!route) throw httpError(404, 'No se encontró el viaje.');
  if (route.status !== ROUTE_STATUS.PLANNED) throw httpError(409, 'El viaje ya no está planeado: no se puede cancelar.');
  await deleteRoute(p.route_id);
  return { message: 'Viaje cancelado.', data: { route_id: p.route_id } };
};

// ============================================================ crear un vehículo (solo administrador)
export const prepareCreateVehicleProposal = async (user, db, args, now = Date.now()) => {
  try {
    if (user.role !== 'admin') return 'Solo un administrador puede registrar vehículos.';
    const parsed = vehicleSchema.safeParse({
      plate: clean(args.plate).toUpperCase().replace(/ /g, ''),
      brand: args.brand ? clean(args.brand) : undefined,
      model: clean(args.model),
      type: clean(args.type),
      capacity_kg: Number(args.capacity_kg),
      status: VEHICLE_STATUS.AVAILABLE,
    });
    if (!parsed.success) return `Faltan o no son válidos estos datos: ${parsed.error.issues.map((i) => i.message).join('; ')}.`;
    const v = parsed.data;
    const { data: same } = await db.from('vehicles').select('id').eq('plate', v.plate).maybeSingle();
    if (same) return `Ya existe un vehículo con la placa ${v.plate}.`;
    const proposal = createProposal({
      user,
      type: 'create_vehicle',
      params: { vehicle: v, items: [] },
      title: 'Registrar un vehículo',
      lines: [
        `Placa: ${v.plate}`,
        `Vehículo: ${[v.brand, v.model].filter(Boolean).join(' ')} (${v.type})`,
        `Capacidad: ${v.capacity_kg.toLocaleString('es-BO')} kg`,
        'Quedará «disponible».',
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

export const applyCreateVehicle = async (db, p, createVehicle) => {
  const { data: same } = await db.from('vehicles').select('id').eq('plate', p.vehicle.plate).maybeSingle();
  if (same) throw httpError(409, `Ya existe un vehículo con la placa ${p.vehicle.plate}.`);
  const vehicle = await createVehicle(p.vehicle);
  return { message: `Vehículo ${p.vehicle.plate} registrado.`, data: { vehicle_id: vehicle?.id ?? null } };
};

// ============================================================ cambiar el estado o la capacidad de un vehículo (o retirarlo)
const STATUS_LABEL = { disponible: 'disponible', en_servicio: 'en servicio', mantenimiento: 'en mantenimiento', retirado: 'retirado' };
const BUSY = [ROUTE_STATUS.PLANNED, ROUTE_STATUS.ACTIVE];

export const prepareUpdateVehicleProposal = async (user, db, { plate, status, capacity_kg }, now = Date.now()) => {
  try {
    if (user.role !== 'admin') return 'Solo un administrador puede cambiar vehículos.';
    const p = clean(plate).replace(/ /g, '');
    if (p.length < 3) return 'Indica la placa del vehículo.';
    const { data: found, error } = await db.from('vehicles').select('id, plate, brand, model, status, capacity_kg').ilike('plate', `%${p}%`).limit(4);
    if (error) throw error;
    if (!found?.length) return `No encontré un vehículo con la placa «${p}».`;
    if (found.length > 1) return `Hay varios vehículos que coinciden con «${p}» (${found.map((v) => v.plate).join(', ')}). Pregúntale al usuario cuál.`;
    const v = found[0];

    const patch = {};
    const lines = [`Vehículo: ${[v.plate, v.brand, v.model].filter(Boolean).join(' ')}`];
    if (status) {
      if (!Object.values(VEHICLE_STATUS).includes(status)) return `El estado «${status}» no existe. Los estados son: ${Object.values(VEHICLE_STATUS).join(', ')}.`;
      if (status === v.status) return `El vehículo ya está ${STATUS_LABEL[v.status] ?? v.status}.`;
      if (status === VEHICLE_STATUS.RETIRED || status === VEHICLE_STATUS.MAINTENANCE) {
        const { data: trips } = await db.from('transport_routes').select('id, origin, destination, departure_time, status').eq('vehicle_id', v.id).in('status', BUSY).limit(10);
        if ((trips ?? []).some((t) => t.status === ROUTE_STATUS.ACTIVE)) return `El vehículo ${v.plate} está ahora en un viaje en tránsito: no se puede cambiar su estado todavía.`;
        if (trips?.length) lines.push(`Aviso: tiene ${trips.length} ${trips.length === 1 ? 'viaje planeado' : 'viajes planeados'} (${trips.slice(0, 2).map(tripName).join('; ')}). Esos viajes conservan el vehículo: reasígnalos si hace falta`);
      }
      patch.status = status;
      lines.push(`Estado: ${STATUS_LABEL[v.status] ?? v.status} → ${STATUS_LABEL[status]}`);
      if (status === VEHICLE_STATUS.RETIRED) lines.push('Retirar un vehículo no lo borra: el historial de viajes lo sigue mostrando.');
    }
    if (capacity_kg !== undefined && capacity_kg !== null) {
      const c = Number(capacity_kg);
      if (!Number.isFinite(c) || c <= 0 || c > 100000) return 'La capacidad debe ser un número de kilos positivo.';
      if (c === Number(v.capacity_kg)) return `El vehículo ya tiene esa capacidad (${c} kg).`;
      patch.capacity_kg = c;
      lines.push(`Capacidad: ${Number(v.capacity_kg).toLocaleString('es-BO')} kg → ${c.toLocaleString('es-BO')} kg`);
    }
    if (!Object.keys(patch).length) return 'Indica qué cambiar: el estado (disponible, en_servicio, mantenimiento o retirado) o la capacidad en kilos.';

    const proposal = createProposal({
      user,
      type: 'update_vehicle',
      params: { vehicle_id: v.id, plate: v.plate, patch, items: [] },
      title: patch.status === VEHICLE_STATUS.RETIRED ? 'Retirar un vehículo' : 'Cambiar un vehículo',
      lines,
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

export const applyUpdateVehicle = async (db, p) => {
  const { data: v } = await db.from('vehicles').select('id, status').eq('id', p.vehicle_id).maybeSingle();
  if (!v) throw httpError(404, 'No se encontró el vehículo.');
  if (p.patch.status === VEHICLE_STATUS.RETIRED || p.patch.status === VEHICLE_STATUS.MAINTENANCE) {
    const { data: moving } = await db.from('transport_routes').select('id').eq('vehicle_id', p.vehicle_id).eq('status', ROUTE_STATUS.ACTIVE).limit(1);
    if (moving?.length) throw httpError(409, 'El vehículo está ahora en un viaje en tránsito: no se puede cambiar su estado.');
  }
  const { error } = await db.from('vehicles').update(p.patch).eq('id', p.vehicle_id);
  if (error) throw error;
  return { message: `Vehículo ${p.plate} actualizado.`, data: { vehicle_id: p.vehicle_id } };
};
