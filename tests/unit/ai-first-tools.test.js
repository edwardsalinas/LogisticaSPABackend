import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTools, toolsForUser, extractAttachments, describeLocation, canDriverSeePackage, startOfTodayBolivia,
} from '../../src/modules/ai-agent/ai-agent.tools.js';

// Base simulada: cada tabla devuelve un resultado fijo y se registran los filtros aplicados
const makeDb = (tables) => {
  const calls = [];
  const db = {
    calls,
    from: (table) => {
      const entry = { table, eq: [], in: [], lt: [] };
      calls.push(entry);
      const result = () => {
        const r = tables[table] ?? { data: [], error: null };
        return typeof r === 'function' ? r(entry) : r;
      };
      const b = {
        select: () => b,
        eq: (c, v) => { entry.eq.push([c, v]); return b; },
        in: (c, v) => { entry.in.push([c, v]); return b; },
        lt: (c, v) => { entry.lt.push([c, v]); return b; },
        gte: (c, v) => { (entry.gte ||= []).push([c, v]); return b; },
        order: () => b,
        limit: () => b,
        or: () => b,
        maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error ?? null }; },
        then: (res, rej) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
  return db;
};

const stats = { getDashboardStats: async () => ({ packagesToday: 3, packagesInTransit: 2, packagesPending: 1, packagesDelayed: 4, packagesIncident: 1, packagesAtAgency: 0, activeRoutes: 2, totalVehicles: 3, totalDrivers: 1, sla: 80 }) };
const run = (user, name, args, db, st = stats) => toolsForUser(user, db, st).find((t) => t.name === name).invoke(args);

const PKG = { id: 'p1', tracking_code: 'TRK-1', status: 'en_transito', origen: 'La Paz', destino: 'Oruro', peso: 2, route_id: 'r1', sender_id: 'cliente-1', created_at: '2026-11-20T10:00:00Z', delivered_at: null, recipient_name: 'Juan Pérez' };
const ROUTE = { id: 'r1', route_code: 'RT-1', origin: 'La Paz', destination: 'Oruro', status: 'en_transito', departure_time: '2026-11-21T12:00:00Z', estimated_arrival: '2026-11-21T16:00:00Z', driver_id: 'driver-1', vehicle_id: 'v1', dest_lat: -17.97, dest_lng: -67.11 };
const LOGS = [
  { status: 'En tránsito: Caracollo', timestamp: '2026-11-21T14:00:00Z', lat: -17.63, lng: -67.24, observations: null },
  { status: 'Inició tránsito desde: La Paz', timestamp: '2026-11-21T12:05:00Z', lat: -16.5, lng: -68.15, observations: null },
];
const fullDb = () => makeDb({
  packages: { data: [PKG] },
  transport_routes: { data: [ROUTE] },
  drivers: { data: [{ full_name: 'Carlos Mendoza' }] },
  vehicles: { data: [{ plate: 'ABC-123', brand: 'Volvo', model: 'FH16' }] },
  route_checkpoints: { data: [{ name: 'Caracollo', lat: -17.63, lng: -67.24, sequence_order: 1 }, { name: 'Patacamaya', lat: -17.24, lng: -67.92, sequence_order: 0 }] },
  tracking_logs: { data: LOGS },
});

// ------------------------------------------------------------------ "¿dónde está mi paquete?"
test('get_package_tracking: estado, ruta, conductor, vehículo, ETA y ubicación aproximada', async () => {
  const out = JSON.parse(await run({ id: 'cliente-1', role: 'client' }, 'get_package_tracking', { code: 'TRK-1' }, fullDb()));
  assert.equal(out.kind, 'package_tracking');
  assert.equal(out.package.status, 'en_transito');
  assert.equal(out.route.driver_name, 'Carlos Mendoza');
  assert.equal(out.route.vehicle, 'ABC-123 Volvo FH16');
  assert.equal(out.route.estimated_arrival, '2026-11-21T16:00:00Z');
  assert.equal(out.location.nearest_checkpoint.name, 'Caracollo');
  assert.equal(out.location.nearest_checkpoint.distance_km, 0);
  assert.ok(out.location.km_to_destination > 40 && out.location.km_to_destination < 120, `km al destino: ${out.location.km_to_destination}`);
  assert.equal(out.location.last_event, 'En tránsito: Caracollo');
  assert.equal(out.timeline.length, 2);
  assert.equal('sender_id' in out.package, false); // sin identificadores internos
  assert.equal('route_id' in out.package, false);
});

test('get_package_tracking: un paquete entregado no tiene ubicación actual', async () => {
  const db = makeDb({ packages: { data: [{ ...PKG, status: 'entregado', delivered_at: '2026-11-21T15:00:00Z' }] }, tracking_logs: { data: LOGS } });
  const out = JSON.parse(await run({ id: 'a', role: 'admin' }, 'get_package_tracking', { code: 'TRK-1' }, db));
  assert.equal(out.location, null);
  assert.equal(out.package.delivered_at, '2026-11-21T15:00:00Z');
});

test('get_package_tracking: un conductor solo ve paquetes de SUS rutas', async () => {
  assert.equal(canDriverSeePackage({ role: 'driver', id: 'driver-1' }, { driver_id: 'driver-1' }), true);
  assert.equal(canDriverSeePackage({ role: 'driver', id: 'driver-2' }, { driver_id: 'driver-1' }), false);
  assert.equal(canDriverSeePackage({ role: 'driver', id: 'driver-1' }, null), false);
  assert.equal(canDriverSeePackage({ role: 'admin', id: 'x' }, null), true);

  assert.match(await run({ id: 'driver-2', role: 'driver' }, 'get_package_tracking', { code: 'TRK-1' }, fullDb()), /No tienes permiso/);
  assert.match(await run({ id: 'driver-1', role: 'driver' }, 'get_package_tracking', { code: 'TRK-1' }, fullDb()), /package_tracking/);
});

test('describeLocation: ignora posiciones 0,0 y devuelve null sin coordenadas válidas', () => {
  assert.equal(describeLocation([], null), null);
  assert.equal(describeLocation([{ lat: 0, lng: 0, status: 'x', timestamp: 't' }], null), null);
  const loc = describeLocation([{ lat: -16.5, lng: -68.15, status: 'Salió', timestamp: 't' }], null);
  assert.equal(loc.nearest_checkpoint, null);
  assert.equal(loc.km_to_destination, null);
});

// ------------------------------------------------------------------ "¿qué paquetes tengo?"
test('list_my_packages: el cliente solo recibe SUS paquetes (filtro en la consulta)', async () => {
  const db = makeDb({ packages: { data: [PKG] } });
  const out = JSON.parse(await run({ id: 'cliente-1', role: 'client' }, 'list_my_packages', {}, db));
  assert.equal(out.kind, 'package_list');
  assert.equal(out.title, 'Tus paquetes');
  assert.deepEqual(db.calls[0].eq, [['sender_id', 'cliente-1']]);
  assert.equal(out.packages[0].tracking_code, 'TRK-1');
  assert.equal('sender_id' in out.packages[0], false);
});

test('list_my_packages: el estado se aplica como filtro y el staff ve todos', async () => {
  const db = makeDb({ packages: { data: [PKG] } });
  await run({ id: 'a', role: 'admin' }, 'list_my_packages', { status: 'entregado' }, db);
  assert.deepEqual(db.calls[0].eq, [['status', 'entregado']]);
});

test('list_my_packages: el conductor solo ve paquetes de sus rutas', async () => {
  const db = makeDb({ transport_routes: { data: [{ id: 'r1' }, { id: 'r2' }] }, packages: { data: [PKG] } });
  await run({ id: 'driver-1', role: 'driver' }, 'list_my_packages', {}, db);
  const byTable = (name) => db.calls.find((c) => c.table === name);
  assert.deepEqual(byTable('transport_routes').eq, [['driver_id', 'driver-1']]);
  assert.deepEqual(byTable('packages').in, [['route_id', ['r1', 'r2']]]);
  // sin rutas: lista vacía (no se filtra por ninguna ruta)
  const empty = makeDb({ transport_routes: { data: [] } });
  const out = JSON.parse(await run({ id: 'driver-9', role: 'driver' }, 'list_my_packages', {}, empty));
  assert.deepEqual(out.packages, []);
  assert.ok(empty.calls.filter((c) => c.table === 'packages').every((c) => c.in.length === 0));
});

// ------------------------------------------------------------------ operación (staff)
test('get_operations_summary: solo administradores y operadores', async () => {
  const ok = JSON.parse(await run({ id: 'a', role: 'admin' }, 'get_operations_summary', {}, makeDb({})));
  assert.equal(ok.kind, 'operations_summary');
  assert.equal(ok.delayed, 4);
  assert.equal(ok.incidents, 1);
  assert.equal(ok.delivery_rate_pct, 80);
  // el cliente ni siquiera tiene la herramienta; y si se invoca directamente, se deniega
  assert.equal(toolsForUser({ id: 'c', role: 'client' }, makeDb({}), stats).some((t) => t.name === 'get_operations_summary'), false);
  const direct = buildTools({ id: 'c', role: 'client' }, makeDb({}), stats).find((t) => t.name === 'get_operations_summary');
  assert.match(await direct.invoke({}), /No tienes permiso/);
});

test('list_packages_needing_attention: siniestros y retrasados con su motivo', async () => {
  const db = makeDb({
    packages: (entry) => (entry.eq.some(([, v]) => v === 'siniestro')
      ? { data: [{ ...PKG, status: 'siniestro' }] }
      : { data: [{ ...PKG, tracking_code: 'TRK-2', status: 'asignado' }] }),
  });
  const out = JSON.parse(await run({ id: 'o', role: 'logistics_operator' }, 'list_packages_needing_attention', {}, db));
  assert.deepEqual(out.packages.map((p) => [p.tracking_code, p.reason.split(':')[0]]), [['TRK-1', 'siniestro'], ['TRK-2', 'retrasado']]);
});

// ------------------------------------------------------------------ conductor y flota
test('get_my_deliveries: agenda del conductor con sus paquetes; otros roles no la usan', async () => {
  const db = makeDb({
    transport_routes: { data: [{ id: 'r1', route_code: 'RT-1', origin: 'La Paz', destination: 'Oruro', status: 'planeada', departure_time: 't', estimated_arrival: null }] },
    packages: { data: [{ tracking_code: 'TRK-1', status: 'asignado', destino: 'Oruro', recipient_name: 'Juan' }] },
  });
  const out = JSON.parse(await run({ id: 'driver-1', role: 'driver' }, 'get_my_deliveries', {}, db));
  assert.equal(out.kind, 'driver_agenda');
  assert.equal(out.routes[0].packages[0].tracking_code, 'TRK-1');
  assert.equal('id' in out.routes[0], false);
  const routeQueries = db.calls.filter((c) => c.table === 'transport_routes');
  assert.equal(routeQueries.length, 2); // en curso y planeadas
  assert.ok(routeQueries.every((q) => q.eq.some(([c, v]) => c === 'driver_id' && v === 'driver-1')));
  const planned = routeQueries.find((q) => q.eq.some(([c, v]) => c === 'status' && v === 'planeada'));
  assert.ok(planned.gte.some(([c]) => c === 'departure_time'), 'las planeadas se limitan a desde hoy');
  const active = routeQueries.find((q) => q.eq.some(([c, v]) => c === 'status' && v === 'en_transito'));
  assert.equal(active.gte, undefined, 'las rutas en curso se muestran aunque hayan salido antes');
  const direct = buildTools({ id: 'a', role: 'admin' }, db, stats).find((t) => t.name === 'get_my_deliveries');
  assert.match(await direct.invoke({}), /solo para conductores/);
});

test('get_fleet_status: solo administradores', async () => {
  const db = makeDb({ vehicles: { data: [{ plate: 'ABC-123', status: 'disponible' }] }, drivers: { data: [{ full_name: 'Juan', status: 'activo' }] } });
  const out = JSON.parse(await run({ id: 'a', role: 'admin' }, 'get_fleet_status', {}, db));
  assert.equal(out.kind, 'fleet_status');
  assert.equal(out.vehicles[0].plate, 'ABC-123');
  const op = buildTools({ id: 'o', role: 'logistics_operator' }, db, stats).find((t) => t.name === 'get_fleet_status');
  assert.match(await op.invoke({}), /No tienes permiso/);
});

// ------------------------------------------------------------------ herramientas visibles por rol y tarjetas
test('cada rol solo recibe las herramientas que puede usar', () => {
  const names = (role) => toolsForUser({ id: 'x', role }, makeDb({}), stats).map((t) => t.name).sort();
  assert.deepEqual(names('client'), ['find_available_trips', 'find_packages_by_person', 'get_package_tracking', 'list_my_packages', 'show_on_screen']);
  assert.ok(names('driver').includes('get_my_deliveries'));
  assert.ok(!names('driver').includes('find_packages_by_person'));
  assert.ok(names('admin').includes('get_fleet_status'));
  assert.ok(!names('logistics_operator').includes('get_fleet_status'));
  assert.deepEqual(names('rol-desconocido'), names('client')); // lo desconocido se trata como cliente
});

test('extractAttachments: convierte la salida de las herramientas en tarjetas', () => {
  const msgs = [
    { type: 'human', content: 'hola' },
    { type: 'tool', content: JSON.stringify({ kind: 'package_tracking', package: { tracking_code: 'TRK-1' } }) },
    { type: 'tool', content: 'No se encontró ningún paquete con ese código.' }, // texto: sin tarjeta
    { type: 'tool', content: JSON.stringify({ kind: 'desconocido', x: 1 }) },   // tipo no permitido
    { type: 'tool', content: JSON.stringify({ kind: 'package_list', title: 'Tus paquetes', packages: [] }) },
    { type: 'ai', content: 'respuesta' },
  ];
  const out = extractAttachments(msgs);
  assert.deepEqual(out.map((a) => a.kind), ['package_tracking', 'package_list']);
});

test('extractAttachments: máximo 3 tarjetas y tolera mensajes raros', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ type: 'tool', content: JSON.stringify({ kind: 'package_list', title: String(i), packages: [] }) }));
  assert.equal(extractAttachments(many).length, 3);
  assert.deepEqual(extractAttachments(undefined), []);
  assert.deepEqual(extractAttachments([null, {}, { type: 'tool', content: { no: 'string' } }]), []);
});

test('startOfTodayBolivia: medianoche de Bolivia (04:00Z), aunque en UTC ya sea el día siguiente', () => {
  assert.equal(startOfTodayBolivia(Date.parse('2026-11-21T18:30:00Z')), '2026-11-21T04:00:00.000Z');
  assert.equal(startOfTodayBolivia(Date.parse('2026-11-22T02:00:00Z')), '2026-11-21T04:00:00.000Z'); // 22:00 del 21 en Bolivia
  assert.equal(startOfTodayBolivia(Date.parse('2026-11-21T03:59:00Z')), '2026-11-20T04:00:00.000Z');
});
