import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _resetProposals, confirmProposal } from '../../src/modules/ai-agent/ai-actions.service.js';
import { applyAssignDriver, prepareCancelProposal, prepareDriverProposal, prepareTripProposal, resolveDriver } from '../../src/modules/ai-agent/ai-agent.fleet-actions.js';
import { toolsForUser } from '../../src/modules/ai-agent/ai-agent.tools.js';

const NOW = Date.parse('2026-11-26T16:00:00Z'); // 12:00 en Bolivia
const ADMIN = { id: 'a1', role: 'admin' };
const OPERATOR = { id: 'o1', role: 'logistics_operator' };
const CLIENT = { id: 'c1', role: 'client' };
const DRIVER = { id: 'd1', role: 'driver' };
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const inH = (h) => new Date(NOW + h * 3600 * 1000).toISOString();

/** Base simulada con lo mínimo del cliente de Supabase: eq, ilike, in, limit, maybeSingle, update. Registra lo que se pide. */
const fakeDb = (tables) => {
  const log = { ilike: [], updates: [] };
  const from = (name) => {
    const q = { filters: [], limit: null, update: null };
    const rows = () => (tables[name] ?? []);
    const run = () => {
      let r = rows().filter((row) => q.filters.every((f) => f(row)));
      if (q.limit != null) r = r.slice(0, q.limit);
      if (q.update) { for (const row of r) Object.assign(row, q.update); log.updates.push({ table: name, payload: q.update, n: r.length }); return { data: null, error: null }; }
      return { data: r, error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: (n) => { q.limit = n; return b; },
      eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
      in: (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return b; },
      gte: (c, v) => { q.filters.push((r) => r[c] >= v); return b; },
      lte: (c, v) => { q.filters.push((r) => r[c] <= v); return b; },
      ilike: (c, pattern) => {
        log.ilike.push([c, pattern]);
        const needle = pattern.replace(/%/g, '').toLowerCase();
        q.filters.push((r) => (pattern.startsWith('%') ? String(r[c]).toLowerCase().includes(needle) : String(r[c]).toLowerCase() === needle));
        return b;
      },
      update: (p) => { q.update = p; return b; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: null }; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, log, tables };
};

const pkg = (o = {}) => ({ id: 'p1', tracking_code: 'TRK-1', status: 'pendiente', route_id: null, created_at: ago(0.5), origen: 'Oruro', destino: 'La Paz', peso: 2, recipient_name: 'Ana Pérez', ...o });
const route = (o = {}) => ({ id: 'r1', route_code: 'RT-1', origin: 'Oruro', destination: 'La Paz', status: 'planeada', departure_time: inH(5), driver_id: null, vehicle_id: null, ...o });
const parse = (s) => JSON.parse(s);

test.beforeEach(() => _resetProposals());

// ============================================================ anular un paquete
test('anular: un paquete pendiente, sin viaje y reciente se propone y NO se modifica nada', async () => {
  const db = fakeDb({ packages: [pkg()] });
  const out = parse(await prepareCancelProposal(OPERATOR, db, { code: 'TRK-1' }, NOW));
  assert.equal(out.kind, 'action_proposal');
  assert.equal(out.action.type, 'cancel_package');
  assert.equal(out.action.title, 'Anular un paquete');
  assert.ok(out.action.lines.some((l) => /TRK-1/.test(l)));
  assert.equal(db.log.updates.length, 0);
  assert.equal(db.tables.packages[0].status, 'pendiente');
});

test('anular: solo el personal; cliente y conductor reciben «sin permiso»', async () => {
  const db = fakeDb({ packages: [pkg()] });
  for (const u of [CLIENT, DRIVER, { id: 'x', role: 'invitado' }]) assert.match(await prepareCancelProposal(u, db, { code: 'TRK-1' }, NOW), /No tienes permiso/);
});

test('anular: explica por qué NO se puede (asignado, ya salió, viejo, inexistente, código inválido)', async () => {
  const db = fakeDb({ packages: [pkg(), pkg({ id: 'p2', tracking_code: 'TRK-2', status: 'asignado', route_id: 'r1' }), pkg({ id: 'p3', tracking_code: 'TRK-3', status: 'en_transito' }), pkg({ id: 'p4', tracking_code: 'TRK-4', created_at: ago(3) })] });
  assert.match(await prepareCancelProposal(ADMIN, db, { code: 'TRK-2' }, NOW), /ya está asignado a un viaje/);
  assert.match(await prepareCancelProposal(ADMIN, db, { code: 'TRK-3' }, NOW), /ya no está pendiente/);
  assert.match(await prepareCancelProposal(ADMIN, db, { code: 'TRK-4' }, NOW), /más de 2 horas/);
  assert.match(await prepareCancelProposal(ADMIN, db, { code: 'TRK-99' }, NOW), /No existe el paquete TRK-99/);
  assert.match(await prepareCancelProposal(ADMIN, db, { code: '' }, NOW), /código de rastreo válido/);
  assert.match(await prepareCancelProposal(ADMIN, db, { code: 'x'.repeat(80) }, NOW), /código de rastreo válido/);
  assert.equal(db.log.updates.length, 0);
});

// ============================================================ asignar conductor
const drivers = () => [{ id: 'dr1', full_name: 'Juan Mamani', status: 'disponible' }, { id: 'dr2', full_name: 'Pedro Quispe', status: 'disponible' }, { id: 'dr3', full_name: 'Pedro Choque', status: 'disponible' }];
const vehicles = () => [{ id: 'v1', plate: '1234ABC', brand: 'Volvo', model: 'FH16', status: 'disponible' }, { id: 'v2', plate: '5678XYZ', status: 'mantenimiento' }];

test('asignar conductor: propone con el viaje y el conductor, sin escribir', async () => {
  const db = fakeDb({ transport_routes: [route()], drivers: drivers(), vehicles: vehicles() });
  const out = parse(await prepareDriverProposal(OPERATOR, db, { route_ref: 'RT-1', driver_name: 'juan' }, NOW));
  assert.equal(out.action.type, 'assign_driver');
  assert.ok(out.action.lines.includes('Conductor: Juan Mamani'));
  assert.equal(db.log.updates.length, 0);
});

test('asignar conductor: con vehículo lo muestra, y avisa si no está disponible', async () => {
  const db = fakeDb({ transport_routes: [route()], drivers: drivers(), vehicles: vehicles() });
  const ok = parse(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'juan', vehicle_plate: '1234ABC' }, NOW));
  assert.ok(ok.action.lines.some((l) => /Vehículo: 1234ABC Volvo FH16/.test(l)));
  const warn = parse(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'juan', vehicle_plate: '5678XYZ' }, NOW));
  assert.ok(warn.action.lines.some((l) => /figura como «mantenimiento»/.test(l)));
});

test('asignar conductor: si el viaje ya tenía otro, dice a quién reemplaza', async () => {
  const db = fakeDb({ transport_routes: [route({ driver_id: 'dr2' })], drivers: drivers() });
  const out = parse(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'juan' }, NOW));
  assert.ok(out.action.lines.includes('Reemplaza a: Pedro Quispe'));
});

test('asignar conductor: rechaza lo que no corresponde', async () => {
  const base = { transport_routes: [route(), route({ id: 'r2', route_code: 'RT-2', status: 'en_transito' }), route({ id: 'r3', route_code: 'RT-3', driver_id: 'dr1' })], drivers: drivers(), vehicles: vehicles() };
  const db = fakeDb(base);
  for (const u of [CLIENT, DRIVER]) assert.match(await prepareDriverProposal(u, db, { route_ref: 'RT-1', driver_name: 'juan' }, NOW), /No tienes permiso/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'NO-EXISTE', driver_name: 'juan' }, NOW), /No encontré ese viaje/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-2', driver_name: 'juan' }, NOW), /ya no está planeado/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'zzz' }, NOW), /No encontré un conductor llamado «zzz»/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'pedro' }, NOW), /varios conductores.*Pedro Quispe, Pedro Choque/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-3', driver_name: 'juan' }, NOW), /ya es el conductor de ese viaje/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'juan', vehicle_plate: 'ZZZ999' }, NOW), /No encontré un vehículo/);
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: '' }, NOW), /nombre del conductor/);
});

test('asignar conductor: un conductor que está en tránsito no se puede asignar; uno con otro viaje cerca solo se avisa', async () => {
  const busy = fakeDb({ transport_routes: [route(), route({ id: 'r9', route_code: 'RT-9', status: 'en_transito', driver_id: 'dr1' })], drivers: drivers() });
  assert.match(await prepareDriverProposal(ADMIN, busy, { route_ref: 'RT-1', driver_name: 'juan' }, NOW), /está ahora en un viaje en tránsito/);

  const close = fakeDb({ transport_routes: [route(), route({ id: 'r8', route_code: 'RT-8', driver_id: 'dr1', departure_time: inH(7) }), route({ id: 'r7', route_code: 'RT-7', driver_id: 'dr1', departure_time: inH(48) })], drivers: drivers() });
  const out = parse(await prepareDriverProposal(ADMIN, close, { route_ref: 'RT-1', driver_name: 'juan' }, NOW));
  assert.equal(out.action.lines.filter((l) => /Aviso: Juan Mamani ya tiene otro viaje cerca/.test(l)).length, 1, 'solo el viaje cercano, no el de dentro de 48 h');
});

test('REGRESIÓN: un conductor con decenas de viajes planeados y uno en tránsito sigue bloqueado (el límite no deja fuera el viaje en tránsito)', async () => {
  const many = Array.from({ length: 80 }, (_, i) => route({ id: `old${i}`, route_code: `OLD-${i}`, driver_id: 'dr1', departure_time: inH(100 + i) }));
  const db = fakeDb({ transport_routes: [route(), ...many, route({ id: 'live', route_code: 'LIVE', status: 'en_transito', driver_id: 'dr1' })], drivers: drivers() });
  assert.match(await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: 'juan' }, NOW), /está ahora en un viaje en tránsito/);
});

test('el nombre completo con marcas («Juan Mamani (Conductor)») también se encuentra, pero nunca por una sola palabra', async () => {
  const db = fakeDb({ drivers: [{ id: 'dr1', full_name: 'Juan Pérez (Conductor)' }, { id: 'dr2', full_name: 'Pedro Quispe' }] });
  assert.equal((await resolveDriver(db, 'Juan Pérez (Conductor)')).driver.id, 'dr1');
  assert.equal((await resolveDriver(db, 'juan pérez')).driver.id, 'dr1');
  assert.match((await resolveDriver(db, 'Pedro Mamani')).error, /No encontré un conductor/, 'un apellido distinto no cae en otro Pedro');
});

test('los nombres hostiles se limpian antes de llegar al filtro de la base de datos', async () => {
  const db = fakeDb({ transport_routes: [route()], drivers: drivers() });
  await prepareDriverProposal(ADMIN, db, { route_ref: 'RT-1', driver_name: "juan', or.(role.eq.admin)%_" }, NOW);
  for (const [, pattern] of db.log.ilike) assert.doesNotMatch(pattern.slice(1, -1), /[%_,.()=]/, pattern);
  assert.deepEqual(await resolveDriver(db, 'a'), { error: 'Indica el nombre del conductor.' });
});

test('confirmar «asignar conductor» vuelve a comprobar el viaje y solo cambia lo pedido', async () => {
  const db = fakeDb({ transport_routes: [route(), route({ id: 'r2', status: 'en_transito' })] });
  const out = await applyAssignDriver(db, { route_id: 'r1', driver_id: 'dr1', vehicle_id: 'v1' });
  assert.match(out.message, /Conductor asignado/);
  assert.deepEqual([db.tables.transport_routes[0].driver_id, db.tables.transport_routes[0].vehicle_id], ['dr1', 'v1']);
  await assert.rejects(applyAssignDriver(db, { route_id: 'r2', driver_id: 'dr1' }), (e) => e.status === 409 && /ya no está planeado/.test(e.message));
  await assert.rejects(applyAssignDriver(db, { route_id: 'nope', driver_id: 'dr1' }), (e) => e.status === 404);
  assert.equal(db.tables.transport_routes[1].driver_id, null, 'el viaje que ya salió no se tocó');
  const noVehicle = fakeDb({ transport_routes: [route({ vehicle_id: 'keep' })] });
  await applyAssignDriver(noVehicle, { route_id: 'r1', driver_id: 'dr2' });
  assert.equal(noVehicle.tables.transport_routes[0].vehicle_id, 'keep', 'sin vehículo en la propuesta, no se borra el que tenía');
});

// ============================================================ crear un viaje
const paths = () => [
  { origin_city: 'Oruro', origin_lat: -17.98, origin_lng: -67.15, destination_city: 'La Paz', dest_lat: -16.5, dest_lng: -68.11, is_active: true },
  { origin_city: 'Sucre', origin_lat: -19.03, origin_lng: -65.26, destination_city: 'Potosí', dest_lat: -19.58, dest_lng: -65.75, is_active: true },
  { origin_city: 'Potosí', origin_lat: -19.58, origin_lng: -65.75, destination_city: 'Sucre', dest_lat: -19.03, dest_lng: -65.26, is_active: false },
];

test('crear viaje: propone con el trayecto, la hora de Bolivia y las coordenadas del trayecto definido', async () => {
  const db = fakeDb({ predefined_routes: paths(), drivers: drivers(), transport_routes: [] });
  const out = parse(await prepareTripProposal(OPERATOR, db, { origin: 'oruro', destination: 'La Paz', date: '2026-11-27', time: '08:30' }, NOW));
  assert.equal(out.action.type, 'create_trip');
  const r = out.action.lines;
  assert.ok(r.includes('Trayecto: Oruro → La Paz'));
  assert.ok(r.includes('Conductor: sin asignar (se puede asignar después)'));
  assert.equal(db.log.updates.length, 0);
  assert.ok(r.some((l) => /08:30|8:30/.test(l)), r.join(' | '));
});

test('crear viaje: 08:30 de Bolivia es 12:30 UTC; la propuesta lleva ese instante, no la hora local', async () => {
  const db = fakeDb({ predefined_routes: paths(), drivers: drivers(), transport_routes: [] });
  const proposal = parse(await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-27', time: '08:30', driver_name: 'juan' }, NOW)).action;
  const confirmed = await confirmProposal(proposal.id, ADMIN, { create_trip: async (p) => ({ message: 'ok', data: { received: p.route } }) });
  assert.equal(confirmed.data.received.departure_time, '2026-11-27T12:30:00.000Z');
  assert.equal(confirmed.data.received.driver_id, 'dr1');
  assert.equal(confirmed.data.received.origin_lat, -17.98);
});

test('crear viaje: rechaza fechas pasadas, formatos malos, trayectos que no existen (y los inactivos) y roles sin permiso', async () => {
  const db = fakeDb({ predefined_routes: paths(), drivers: drivers(), transport_routes: [] });
  for (const u of [CLIENT, DRIVER]) assert.match(await prepareTripProposal(u, db, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-27', time: '08:30' }, NOW), /No tienes permiso/);
  assert.match(await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-25', time: '08:30' }, NOW), /ya pasaron/);
  assert.match(await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-26', time: '12:02' }, NOW), /ya pasaron/);
  assert.match(await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'La Paz', date: 'mañana', time: '08:30' }, NOW), /AAAA-MM-DD/);
  assert.match(await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-27', time: '8 y media' }, NOW), /HH:mm/);
  assert.match(await prepareTripProposal(ADMIN, db, { origin: '', destination: 'La Paz', date: '2026-11-27', time: '08:30' }, NOW), /ciudad de origen/);
  const none = await prepareTripProposal(ADMIN, db, { origin: 'Oruro', destination: 'Tarija', date: '2026-11-27', time: '08:30' }, NOW);
  assert.match(none, /No hay un trayecto definido de Oruro a Tarija/);
  assert.match(none, /Oruro → La Paz, Sucre → Potosí/);
  assert.doesNotMatch(none, /Potosí → Sucre/, 'un trayecto inactivo no se ofrece');
  assert.match(await prepareTripProposal(ADMIN, db, { origin: 'Potosí', destination: 'Sucre', date: '2026-11-27', time: '08:30' }, NOW), /No hay un trayecto definido/);
});

test('crear viaje: un conductor en tránsito se rechaza; uno con otro viaje cerca solo se avisa', async () => {
  const busy = fakeDb({ predefined_routes: paths(), drivers: drivers(), transport_routes: [route({ id: 'r9', status: 'en_transito', driver_id: 'dr1' })] });
  assert.match(await prepareTripProposal(ADMIN, busy, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-27', time: '08:30', driver_name: 'juan' }, NOW), /está ahora en un viaje en tránsito/);
  const close = fakeDb({ predefined_routes: paths(), drivers: drivers(), transport_routes: [route({ id: 'r8', driver_id: 'dr1', departure_time: '2026-11-27T14:00:00.000Z' })] });
  const out = parse(await prepareTripProposal(ADMIN, close, { origin: 'Oruro', destination: 'La Paz', date: '2026-11-27', time: '08:30', driver_name: 'juan' }, NOW));
  assert.ok(out.action.lines.some((l) => /Aviso: Juan Mamani ya tiene otro viaje cerca/.test(l)));
});

// ============================================================ quién tiene estas herramientas
const names = (role) => toolsForUser({ id: 'u', role }).map((t) => t.name);

test('solo el personal tiene las tres herramientas nuevas; cliente y conductor no', () => {
  const NEW = ['propose_cancel_package', 'propose_assign_driver', 'propose_create_trip'];
  for (const role of ['admin', 'logistics_operator']) for (const t of NEW) assert.ok(names(role).includes(t), `${role} ${t}`);
  for (const role of ['client', 'driver', undefined, 'invitado']) for (const t of NEW) assert.equal(names(role).includes(t), false, `${role} ${t}`);
});

test('un cliente o conductor no puede CONFIRMAR estas acciones aunque conociera una propuesta', async () => {
  const db = fakeDb({ packages: [pkg()] });
  const proposal = parse(await prepareCancelProposal(ADMIN, db, { code: 'TRK-1' }, NOW)).action;
  for (const u of [CLIENT, DRIVER]) await assert.rejects(confirmProposal(proposal.id, u, { cancel_package: async () => ({ message: 'x' }) }), (e) => [403, 404].includes(e.status));
});
