import { createProposal } from './ai-actions.service.js';
import { proposalResult } from './ai-proposal-result.js';
import { parseWindow } from './ai-agent.availability.js';
import { CANCEL_WINDOW_MS, PACKAGE_STATUS, ROUTE_STATUS } from '../logistics/logistics.schema.js';

/**
 * Más acciones con confirmación: anular un paquete recién creado, asignar conductor (y vehículo) a un viaje planeado y crear un viaje.
 * Igual que las demás, NO modifican nada: validan permisos y estado y devuelven una propuesta que el usuario confirma. Al confirmar, los
 * ejecutores usan los mismos servicios de siempre. Devuelven el JSON de la propuesta o un texto con el motivo del rechazo.
 */
const OPS = ['admin', 'logistics_operator'];
const DENIED = 'No tienes permiso para realizar esa acción.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3600 * 1000;
const NEAR_TRIP_MS = 4 * HOUR; // otro viaje del conductor dentro de esta distancia se avisa
const MIN_LEAD_MS = 5 * 60 * 1000;

// Texto libre que llegará a un filtro de la base de datos: solo letras, números, espacios, apóstrofo y guion.
const clean = (s) => String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim();

const whenText = (iso) => new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const tripName = (r) => `${r.origin} → ${r.destination}, sale ${whenText(r.departure_time)}`;

const failed = (e) => `No se pudo preparar la acción: ${e.message}`;

// ============================================================ anular un paquete
const CANCEL_TEXT = {
  [PACKAGE_STATUS.ASSIGNED]: 'ya está asignado a un viaje: primero hay que quitarlo del viaje',
};

export const prepareCancelProposal = async (user, db, { code }, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const c = String(code ?? '').trim();
    if (c.length < 3 || c.length > 64) return 'Indica un código de rastreo válido (empieza con TRK-).';
    const { data: pkg, error } = await db.from('packages').select('id, tracking_code, status, route_id, created_at, origen, destino, peso, recipient_name').eq('tracking_code', c).maybeSingle();
    if (error) throw error;
    if (!pkg) return `No existe el paquete ${c}.`;
    if (pkg.route_id || pkg.status === PACKAGE_STATUS.ASSIGNED) return `El paquete ${pkg.tracking_code} ${CANCEL_TEXT[PACKAGE_STATUS.ASSIGNED]}.`;
    if (pkg.status !== PACKAGE_STATUS.PENDING) return `El paquete ${pkg.tracking_code} ya no está pendiente: solo se pueden anular paquetes pendientes y sin viaje.`;
    if (pkg.created_at && now - new Date(pkg.created_at).getTime() > CANCEL_WINDOW_MS) {
      return `El paquete ${pkg.tracking_code} se creó hace más de 2 horas: ya no se puede anular desde aquí.`;
    }
    const proposal = createProposal({
      user,
      type: 'cancel_package',
      params: { items: [{ package_id: pkg.id, tracking_code: pkg.tracking_code }] },
      title: 'Anular un paquete',
      lines: [
        `Paquete: ${pkg.tracking_code} (${pkg.origen} → ${pkg.destino}, ${pkg.peso} kg)`,
        `Para: ${pkg.recipient_name}`,
        'Se marcará como «Cancelado» y no se podrá volver a usar. Solo se anulan paquetes pendientes, sin viaje y creados hace menos de 2 horas.',
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

// ============================================================ buscar conductor, vehículo y viaje por lo que dijo la persona
/** { driver } | { error }: exactamente uno, o el motivo (con las opciones si hay varios). */
export const resolveDriver = async (db, name) => {
  const n = clean(name);
  if (n.length < 2) return { error: 'Indica el nombre del conductor.' };
  // Si el nombre completo no coincide (el nombre guardado puede llevar paréntesis u otras marcas que se limpian: «Juan Pérez (Conductor)»),
  // se prueba con las dos primeras palabras (nunca con una sola: «Pedro Mamani» no debe terminar proponiendo a «Pedro Quispe»).
  const words = n.split(' ');
  const attempts = [n, words.slice(0, 2).join(' ')].filter((a, i, all) => a.length >= 2 && all.indexOf(a) === i);
  let data = [];
  for (const attempt of attempts) {
    const res = await db.from('drivers').select('id, full_name, status, current_vehicle_id').ilike('full_name', `%${attempt}%`).limit(6);
    if (res.error) throw res.error;
    if (res.data?.length) { data = res.data; break; }
  }
  if (!data.length) return { error: `No encontré un conductor llamado «${n}».` };
  if (data.length > 1) return { error: `Hay varios conductores que coinciden con «${n}» (${data.map((d) => d.full_name).join(', ')}). Pregúntale al usuario cuál.` };
  return { driver: data[0] };
};

export const resolveVehicle = async (db, plate) => {
  const p = clean(plate);
  if (p.length < 3) return { error: 'Indica la placa del vehículo.' };
  const { data, error } = await db.from('vehicles').select('id, plate, brand, model, status, capacity_kg').ilike('plate', `%${p}%`).limit(4);
  if (error) throw error;
  if (!data?.length) return { error: `No encontré un vehículo con la placa «${p}».` };
  if (data.length > 1) return { error: `Hay varios vehículos que coinciden con «${p}» (${data.map((v) => v.plate).join(', ')}). Pregúntale al usuario cuál.` };
  return { vehicle: data[0] };
};

const vehicleText = (v) => [v.plate, v.brand, v.model].filter(Boolean).join(' ');

/**
 * Otros viajes del conductor: uno en tránsito lo bloquea; uno planeado muy cerca de la salida se avisa. Cada cosa en su PROPIA consulta y con
 * la ventana de tiempo dentro de la consulta: un conductor acumula decenas de viajes planeados (los genera el planificador) y, con un
 * límite general antes de filtrar, el viaje en tránsito quedaba fuera de la lista y se asignaba a alguien que ya iba en ruta.
 */
const driverConflicts = async (db, driverId, departureISO, exceptRouteId = null) => {
  const cols = 'id, origin, destination, departure_time, status';
  const dep = Date.parse(departureISO);
  const [transit, nearby] = await Promise.all([
    db.from('transport_routes').select(cols).eq('driver_id', driverId).eq('status', ROUTE_STATUS.ACTIVE).limit(5),
    db.from('transport_routes').select(cols).eq('driver_id', driverId).eq('status', ROUTE_STATUS.PLANNED)
      .gte('departure_time', new Date(dep - NEAR_TRIP_MS).toISOString()).lte('departure_time', new Date(dep + NEAR_TRIP_MS).toISOString()).limit(20),
  ]);
  if (transit.error) throw transit.error;
  if (nearby.error) throw nearby.error;
  const onTheRoad = (transit.data ?? []).find((r) => r.id !== exceptRouteId);
  const near = (nearby.data ?? []).filter((r) => r.id !== exceptRouteId);
  return { onTheRoad, near };
};

// ============================================================ asignar conductor (y vehículo) a un viaje planeado
export const prepareDriverProposal = async (user, db, { route_ref, driver_name, vehicle_plate }, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const ref = String(route_ref ?? '').trim();
    const q = db.from('transport_routes').select('id, route_code, origin, destination, status, departure_time, driver_id, vehicle_id');
    const { data: route } = await (UUID_RE.test(ref) ? q.eq('id', ref) : q.eq('route_code', ref)).maybeSingle();
    if (!route) return 'No encontré ese viaje. Pídele al usuario que elija uno de los que mostró la disponibilidad.';
    if (route.status !== ROUTE_STATUS.PLANNED) return 'Ese viaje ya no está planeado (ya salió o terminó): no se le puede cambiar el conductor.';

    const d = await resolveDriver(db, driver_name);
    if (d.error) return d.error;
    let vehicle = null;
    if (vehicle_plate) {
      const v = await resolveVehicle(db, vehicle_plate);
      if (v.error) return v.error;
      vehicle = v.vehicle;
    }
    if (route.driver_id === d.driver.id && (!vehicle || route.vehicle_id === vehicle.id)) return `${d.driver.full_name} ya es el conductor de ese viaje.`;

    const { onTheRoad, near } = await driverConflicts(db, d.driver.id, route.departure_time, route.id);
    if (onTheRoad) return `${d.driver.full_name} está ahora en un viaje en tránsito (${onTheRoad.origin} → ${onTheRoad.destination}): no se le puede asignar otro todavía.`;

    let current = null;
    if (route.driver_id && route.driver_id !== d.driver.id) {
      const { data } = await db.from('drivers').select('full_name').eq('id', route.driver_id).maybeSingle();
      current = data?.full_name ?? 'otro conductor';
    }
    const proposal = createProposal({
      user,
      type: 'assign_driver',
      params: { route_id: route.id, driver_id: d.driver.id, ...(vehicle ? { vehicle_id: vehicle.id } : {}), items: [] },
      title: 'Asignar conductor a un viaje',
      lines: [
        `Viaje: ${tripName(route)}`,
        `Conductor: ${d.driver.full_name}`,
        ...(vehicle ? [`Vehículo: ${vehicleText(vehicle)}`] : []),
        ...(current ? [`Reemplaza a: ${current}`] : []),
        ...(vehicle && vehicle.status && vehicle.status !== 'disponible' ? [`Aviso: el vehículo figura como «${vehicle.status}»`] : []),
        ...near.map((r) => `Aviso: ${d.driver.full_name} ya tiene otro viaje cerca de esa hora (${tripName(r)})`),
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};

/** Lo que hace «asignar conductor» al CONFIRMAR: vuelve a comprobar el viaje (pudo salir entre proponer y confirmar) y aplica el cambio. */
export const applyAssignDriver = async (db, p) => {
  const { data: route } = await db.from('transport_routes').select('id, status').eq('id', p.route_id).maybeSingle();
  if (!route) throw Object.assign(new Error('No se encontró el viaje.'), { status: 404 });
  if (route.status !== ROUTE_STATUS.PLANNED) throw Object.assign(new Error('El viaje ya no está planeado (ya salió o terminó).'), { status: 409 });
  const { error } = await db.from('transport_routes')
    .update({ driver_id: p.driver_id, ...(p.vehicle_id ? { vehicle_id: p.vehicle_id } : {}) })
    .eq('id', p.route_id).eq('status', ROUTE_STATUS.PLANNED);
  if (error) throw error;
  return { message: 'Conductor asignado al viaje.', data: { route_id: p.route_id } };
};

// ============================================================ crear un viaje
export const prepareTripProposal = async (user, db, { origin, destination, date, time, driver_name, vehicle_plate }, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const o = clean(origin);
    const dst = clean(destination);
    if (o.length < 2 || dst.length < 2) return 'Indica la ciudad de origen y la de destino.';
    const win = parseWindow({ date, from_time: time, to_time: time });
    if (win.error) return win.error;
    if (win.start < now + MIN_LEAD_MS) return 'La fecha y hora de salida ya pasaron. Indica una salida futura.';

    // solo los trayectos que la empresa tiene definidos (con sus coordenadas)
    const { data: paths, error } = await db.from('predefined_routes').select('origin_city, origin_lat, origin_lng, destination_city, dest_lat, dest_lng').eq('is_active', true).ilike('origin_city', o).ilike('destination_city', dst).limit(2);
    if (error) throw error;
    if (!paths?.length) {
      const { data: all } = await db.from('predefined_routes').select('origin_city, destination_city').eq('is_active', true).limit(30);
      const list = (all ?? []).map((r) => `${r.origin_city} → ${r.destination_city}`).join(', ');
      return `No hay un trayecto definido de ${o} a ${dst}.${list ? ` Los trayectos disponibles son: ${list}.` : ''}`;
    }
    const path = paths[0];

    let driver = null;
    let vehicle = null;
    let near = [];
    if (driver_name) {
      const d = await resolveDriver(db, driver_name);
      if (d.error) return d.error;
      driver = d.driver;
      const conflicts = await driverConflicts(db, driver.id, new Date(win.start).toISOString());
      if (conflicts.onTheRoad) return `${driver.full_name} está ahora en un viaje en tránsito: elige otro conductor o déjalo sin conductor por ahora.`;
      near = conflicts.near;
    }
    if (vehicle_plate) {
      const v = await resolveVehicle(db, vehicle_plate);
      if (v.error) return v.error;
      vehicle = v.vehicle;
    }
    const departure = new Date(win.start).toISOString();
    const proposal = createProposal({
      user,
      type: 'create_trip',
      params: {
        items: [],
        route: {
          origin: path.origin_city, destination: path.destination_city,
          origin_lat: path.origin_lat, origin_lng: path.origin_lng, dest_lat: path.dest_lat, dest_lng: path.dest_lng,
          departure_time: departure,
          ...(driver ? { driver_id: driver.id } : {}),
          ...(vehicle ? { vehicle_id: vehicle.id } : {}),
        },
      },
      title: 'Crear un viaje',
      lines: [
        `Trayecto: ${path.origin_city} → ${path.destination_city}`,
        `Sale: ${whenText(departure)}`,
        driver ? `Conductor: ${driver.full_name}` : 'Conductor: sin asignar (se puede asignar después)',
        ...(vehicle ? [`Vehículo: ${vehicleText(vehicle)}`] : []),
        ...near.map((r) => `Aviso: ${driver.full_name} ya tiene otro viaje cerca de esa hora (${tripName(r)})`),
      ],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return failed(e);
  }
};
