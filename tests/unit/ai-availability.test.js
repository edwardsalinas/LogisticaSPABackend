import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindow, overlaps, _useClock } from '../../src/modules/ai-agent/ai-agent.availability.js';
import { buildTools, toolsForUser, extractAttachments } from '../../src/modules/ai-agent/ai-agent.tools.js';
import { upcomingDaysText } from '../../src/modules/ai-agent/ai-agent.service.js';
import { chatSchema } from '../../src/modules/ai-agent/ai-agent.controller.js';
import { _resetProposals } from '../../src/modules/ai-agent/ai-actions.service.js';

// Base simulada: cada tabla devuelve filas fijas (o las calcula según los filtros) y registra los filtros
const makeDb = (tables) => {
  const calls = [];
  const db = {
    calls,
    from: (table) => {
      const entry = { table, eq: [], in: [], gte: [], lte: [], ilike: [] };
      calls.push(entry);
      const result = () => {
        const r = tables[table] ?? { data: [] };
        return typeof r === 'function' ? r(entry) : r;
      };
      const b = {
        select: () => b, order: () => b, limit: () => b,
        eq: (c, v) => { entry.eq.push([c, v]); return b; },
        in: (c, v) => { entry.in.push([c, v]); return b; },
        gte: (c, v) => { entry.gte.push([c, v]); return b; },
        lte: (c, v) => { entry.lte.push([c, v]); return b; },
        ilike: (c, v) => { entry.ilike.push([c, v]); return b; },
        maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }; },
        then: (res, rej) => Promise.resolve(result()).then((r) => ({ error: null, ...r })).then(res, rej),
      };
      return b;
    },
  };
  return db;
};

// «Ahora» fijo: lo disponible depende de la hora actual y estas pruebas usan fechas concretas (jueves 2026-11-26, 10:00 en Bolivia)
const NOW = Date.parse('2026-11-26T14:00:00Z');
test.beforeEach(() => _useClock(() => NOW));
test.after(() => _useClock());

const ADMIN = { id: 'a', role: 'admin' };
const CLIENT = { id: 'c', role: 'client' };
const run = (user, name, args, db) => buildTools(user, db, {}).find((t) => t.name === name).invoke(args);

// Viernes 2026-11-27, 15:00 a 17:00 en Bolivia (UTC-4) = 19:00Z a 21:00Z
const ROUTE_A = { id: 'r-a', route_code: 'RT-A', origin: 'Oruro', destination: 'La Paz', status: 'planeada', departure_time: '2026-11-27T19:30:00Z', estimated_arrival: '2026-11-27T23:00:00Z', vehicle_id: 'v1' };
const ROUTE_B = { id: 'r-b', route_code: null, origin: 'Cochabamba', destination: 'La Paz', status: 'planeada', departure_time: '2026-11-27T20:30:00Z', estimated_arrival: null, vehicle_id: 'v2' };

// ------------------------------------------------------------------ ventana de tiempo
test('parseWindow: las horas de Bolivia se convierten a UTC (+4 h)', () => {
  const w = parseWindow({ date: '2026-11-27', from_time: '15:00', to_time: '17:00' });
  assert.equal(w.fromISO, '2026-11-27T19:00:00.000Z');
  assert.equal(w.toISO, '2026-11-27T21:00:00.000Z');
});

test('parseWindow: por defecto cubre todo el día de Bolivia', () => {
  const w = parseWindow({ date: '2026-11-27' });
  assert.equal(w.fromISO, '2026-11-27T04:00:00.000Z');
  assert.equal(w.toISO, '2026-11-28T03:59:00.000Z');
});

test('parseWindow: rechaza fechas, horas y rangos inválidos', () => {
  assert.match(parseWindow({ date: '27/11/2026' }).error, /AAAA-MM-DD/);
  assert.match(parseWindow({ date: '2026-11-27', from_time: '25:00' }).error, /HH:mm/);
  assert.match(parseWindow({ date: '2026-11-27', from_time: '3pm' }).error, /HH:mm/);
  assert.match(parseWindow({ date: '2026-11-27', from_time: '17:00', to_time: '15:00' }).error, /posterior/);
  assert.match(parseWindow({}).error, /AAAA-MM-DD/);
});

test('overlaps: solapamiento de intervalos', () => {
  assert.equal(overlaps(10, 20, 15, 25), true);
  assert.equal(overlaps(10, 20, 20, 30), true);   // se tocan
  assert.equal(overlaps(10, 20, 21, 30), false);
  assert.equal(overlaps(10, 40, 15, 20), true);   // uno dentro del otro
});

test('calendario del prompt: los próximos días con su fecha exacta (hora de Bolivia)', () => {
  // 2026-11-21 (sábado) 22:00 en Bolivia = 2026-11-22T02:00Z
  const text = upcomingDaysText(Date.parse('2026-11-22T02:00:00Z'), 8);
  assert.match(text, /^sábado 2026-11-21 \(hoy\); domingo 2026-11-22 \(mañana\); lunes 2026-11-23 \(pasado mañana\);/);
  assert.match(text, /viernes 2026-11-27/);
  assert.equal(text.split(';').length, 8);
});

// ------------------------------------------------------------------ "¿qué viajes a La Paz hay el viernes de 3 a 5?"
const tripsDb = (routes) => makeDb({ transport_routes: routes, vehicles: { data: [] }, packages: { data: [] } });

test('find_available_trips: filtra por ventana y destino y calcula el espacio libre', async () => {
  const db = makeDb({
    transport_routes: { data: [ROUTE_A, ROUTE_B] },
    vehicles: { data: [{ id: 'v1', plate: 'ABC-123', brand: 'Volvo', model: 'FH16', capacity_kg: 1000 }, { id: 'v2', plate: 'XYZ-789', brand: 'Mercedes', model: 'Sprinter', capacity_kg: 100 }] },
    packages: { data: [{ route_id: 'r-a', peso: 250 }, { route_id: 'r-a', peso: 150 }, { route_id: 'r-b', peso: 90 }] },
  });
  const out = JSON.parse(await run(CLIENT, 'find_available_trips', { date: '2026-11-27', from_time: '15:00', to_time: '17:00', destination: 'La Paz' }, db));
  assert.equal(out.kind, 'available_trips');
  const q = db.calls.find((c) => c.table === 'transport_routes');
  assert.deepEqual(q.eq, [['status', 'planeada']]);
  assert.deepEqual(q.gte[0], ['departure_time', '2026-11-27T19:00:00.000Z']);
  assert.deepEqual(q.lte[0], ['departure_time', '2026-11-27T21:00:00.000Z']);
  assert.deepEqual(q.ilike, [['destination', '%La Paz%']]);

  assert.equal(out.trips.length, 2);
  const [a, b] = out.trips;
  assert.deepEqual([a.ref, a.capacity_kg, a.used_kg, a.free_kg, a.fits], ['RT-A', 1000, 400, 600, true]);
  assert.deepEqual([b.ref, b.free_kg], ['r-b', 10]); // sin código se usa el id
  assert.equal(out.can_schedule, false); // un cliente consulta; no agenda
});

test('find_available_trips: indica si el paquete cabe según su peso', async () => {
  const mk = () => makeDb({
    transport_routes: { data: [ROUTE_B] },
    vehicles: { data: [{ id: 'v2', capacity_kg: 100, plate: 'XYZ-789' }] },
    packages: { data: [{ route_id: 'r-b', peso: 90 }] },
  });
  const small = JSON.parse(await run(ADMIN, 'find_available_trips', { date: '2026-11-27', weight_kg: 5 }, mk()));
  assert.equal(small.trips[0].fits, true);
  const big = JSON.parse(await run(ADMIN, 'find_available_trips', { date: '2026-11-27', weight_kg: 50 }, mk()));
  assert.equal(big.trips[0].fits, false);
  assert.equal(big.can_schedule, true);
  assert.match(await run(ADMIN, 'find_available_trips', { date: '2026-11-27', weight_kg: -3 }, mk()), /peso debe ser/);
});

test('find_available_trips: sin viajes en esa ventana ofrece los próximos como alternativa', async () => {
  let n = 0;
  const db = makeDb({
    transport_routes: () => (++n === 1 ? { data: [] } : { data: [ROUTE_A] }), // 1ª consulta: la ventana; 2ª: alternativas
    vehicles: { data: [{ id: 'v1', capacity_kg: 1000, plate: 'ABC-123' }] },
    packages: { data: [] },
  });
  const out = JSON.parse(await run(CLIENT, 'find_available_trips', { date: '2026-11-27', from_time: '15:00', to_time: '17:00', destination: 'La Paz' }, db));
  assert.equal(out.trips.length, 0);
  assert.equal(out.alternatives.length, 1);
  assert.equal(out.alternatives[0].ref, 'RT-A');
  const alt = db.calls.filter((c) => c.table === 'transport_routes')[1];
  assert.deepEqual(alt.gte[0], ['departure_time', '2026-11-27T21:00:00.000Z']); // desde el final de la ventana
});

test('find_available_trips: la ciudad se sanea (no puede alterar el filtro) y la fecha se valida', async () => {
  const db = tripsDb({ data: [] });
  await run(CLIENT, 'find_available_trips', { date: '2026-11-27', destination: "La Paz%,destination.neq.x'" }, db);
  const q = db.calls.find((c) => c.table === 'transport_routes');
  assert.deepEqual(q.ilike, [['destination', "%La Paz destination neq x'%"]]);
  assert.match(await run(CLIENT, 'find_available_trips', { date: 'el viernes' }, db), /AAAA-MM-DD/);
});

// ------------------------------------------------------------------ flota libre (personal)
test('check_fleet_availability: vehículos y conductores ocupados por viajes que se solapan', async () => {
  const db = makeDb({
    vehicles: { data: [{ id: 'v1', plate: 'ABC-123', brand: 'Volvo', model: 'FH16', capacity_kg: 1000 }, { id: 'v2', plate: 'XYZ-789', brand: 'Mercedes', model: 'Sprinter', capacity_kg: 100 }] },
    drivers: { data: [{ id: 'd1', full_name: 'Juan' }, { id: 'd2', full_name: 'Ana' }] },
    transport_routes: { data: [
      { vehicle_id: 'v1', driver_id: 'd1', departure_time: '2026-11-27T19:30:00Z', estimated_arrival: '2026-11-27T23:00:00Z' }, // dentro de la ventana
      { vehicle_id: 'v2', driver_id: 'd2', departure_time: '2026-11-27T10:00:00Z', estimated_arrival: '2026-11-27T12:00:00Z' }, // terminó antes
    ] },
  });
  const out = JSON.parse(await run(ADMIN, 'check_fleet_availability', { date: '2026-11-27', from_time: '15:00', to_time: '17:00' }, db));
  assert.equal(out.kind, 'fleet_availability');
  assert.deepEqual(out.vehicles_busy.map((v) => v.plate), ['ABC-123']);
  assert.deepEqual(out.vehicles_free.map((v) => v.plate), ['XYZ-789']);
  assert.deepEqual(out.drivers_busy.map((d) => d.name), ['Juan']);
  assert.deepEqual(out.drivers_free.map((d) => d.name), ['Ana']);
});

test('check_fleet_availability: un viaje que salió antes y sigue en curso también ocupa el recurso; sin llegada se suponen 2 h', async () => {
  const mk = (route) => makeDb({ vehicles: { data: [{ id: 'v1', plate: 'A' }] }, drivers: { data: [{ id: 'd1', full_name: 'J' }] }, transport_routes: { data: [route] } });
  const running = JSON.parse(await run(ADMIN, 'check_fleet_availability', { date: '2026-11-27', from_time: '15:00', to_time: '17:00' }, mk({ vehicle_id: 'v1', driver_id: 'd1', departure_time: '2026-11-27T17:00:00Z', estimated_arrival: '2026-11-27T20:00:00Z' })));
  assert.equal(running.vehicles_busy.length, 1);
  const noEta = JSON.parse(await run(ADMIN, 'check_fleet_availability', { date: '2026-11-27', from_time: '15:00', to_time: '17:00' }, mk({ vehicle_id: 'v1', driver_id: 'd1', departure_time: '2026-11-27T17:30:00Z', estimated_arrival: null })));
  assert.equal(noEta.vehicles_busy.length, 1); // 17:30Z + 2 h cubre la ventana 19:00Z–21:00Z
  assert.match(noEta.assumption, /2 horas/);
});

test('check_fleet_availability: solo administradores y operadores', async () => {
  assert.match(await run(CLIENT, 'check_fleet_availability', { date: '2026-11-27' }, makeDb({})), /No tienes permiso/);
  assert.match(await run({ id: 'd', role: 'driver' }, 'check_fleet_availability', { date: '2026-11-27' }, makeDb({})), /No tienes permiso/);
  const names = (role) => toolsForUser({ id: 'x', role }, makeDb({}), {}).map((t) => t.name);
  assert.ok(names('client').includes('find_available_trips'));
  assert.ok(!names('client').includes('check_fleet_availability'));
  assert.ok(names('logistics_operator').includes('check_fleet_availability'));
  assert.ok(names('driver').includes('find_available_trips'));
});

// ------------------------------------------------------------------ agendar el paquete en un viaje
const createDb = (route, vehicle, loads) => makeDb({ transport_routes: { data: route ? [route] : [] }, vehicles: { data: vehicle ? [vehicle] : [] }, packages: { data: loads } });
const NEW_PKG = { origen: 'Oruro', destino: 'La Paz', peso: 20, recipient_name: 'María Quispe', route_ref: 'RT-A' };

test('agendar: con espacio, la propuesta indica el viaje y guarda route_id', async () => {
  _resetProposals();
  const db = createDb(ROUTE_A, { capacity_kg: 1000 }, [{ peso: 400 }]);
  const out = JSON.parse(await run(ADMIN, 'propose_create_package', NEW_PKG, db));
  assert.equal(out.action.title, 'Registrar un paquete y agendarlo');
  assert.ok(out.action.lines.some((l) => l.startsWith('Se agenda en el viaje Oruro → La Paz')));
});

test('agendar: sin espacio, sin viaje o con viaje ya iniciado se rechaza antes de proponer', async () => {
  _resetProposals();
  assert.match(await run(ADMIN, 'propose_create_package', NEW_PKG, createDb(ROUTE_A, { capacity_kg: 1000 }, [{ peso: 990 }])), /no tiene espacio: quedan 10 kg/);
  assert.match(await run(ADMIN, 'propose_create_package', NEW_PKG, createDb(null, null, [])), /No encontré ese viaje/);
  assert.match(await run(ADMIN, 'propose_create_package', NEW_PKG, createDb({ ...ROUTE_A, status: 'en_transito' }, { capacity_kg: 1000 }, [])), /ya no está disponible/);
});

test('agendar: un cliente no puede (solo el personal)', async () => {
  assert.match(await run(CLIENT, 'propose_create_package', NEW_PKG, createDb(ROUTE_A, { capacity_kg: 1000 }, [])), /No tienes permiso/);
});

// ------------------------------------------------------------------ esquema del chat y tarjetas
test('chatSchema: acepta la bandera de voz y conversaciones más largas (16 mensajes)', () => {
  assert.equal(chatSchema.parse({ message: 'hola', voice: true }).voice, true);
  assert.equal(chatSchema.parse({ message: 'hola' }).voice, undefined);
  assert.throws(() => chatSchema.parse({ message: 'hola', voice: 'si' }));
  const history = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
  assert.doesNotThrow(() => chatSchema.parse({ message: 'hola', history }));
  assert.throws(() => chatSchema.parse({ message: 'hola', history: [...history, { role: 'user', content: 'x' }] }));
});

test('la disponibilidad llega al navegador como tarjeta', () => {
  const msgs = [
    { type: 'tool', content: JSON.stringify({ kind: 'available_trips', trips: [], alternatives: [] }) },
    { type: 'tool', content: JSON.stringify({ kind: 'fleet_availability', vehicles_free: [] }) },
  ];
  assert.deepEqual(extractAttachments(msgs).map((a) => a.kind), ['available_trips', 'fleet_availability']);
});

test('el vehículo no repite la marca cuando el modelo ya la incluye ("Volvo Volvo FH16")', async () => {
  const mk = (brand, model) => makeDb({
    vehicles: { data: [{ id: 'v1', plate: 'ABC-123', brand, model }] },
    drivers: { data: [] },
    transport_routes: { data: [] },
  });
  const out = async (brand, model) => JSON.parse(await run(ADMIN, 'check_fleet_availability', { date: '2026-11-27' }, mk(brand, model))).vehicles_free[0].vehicle;
  assert.equal(await out('Volvo', 'Volvo FH16'), 'ABC-123 Volvo FH16');
  assert.equal(await out('Mercedes', 'Sprinter'), 'ABC-123 Mercedes Sprinter');
  assert.equal(await out(null, 'Sprinter'), 'ABC-123 Sprinter');
});

// ============================================================ lo disponible es lo que AÚN no salió
test('un viaje planeado cuya hora ya pasó no se ofrece como disponible: la ventana empieza «ahora»', async () => {
  // «hoy» entero (jueves 26): la consulta no puede empezar antes de ahora (14:00Z) aunque el día empiece a las 04:00Z
  const db = makeDb({ transport_routes: { data: [] }, vehicles: { data: [] }, packages: { data: [] } });
  await run(ADMIN, 'find_available_trips', { date: '2026-11-26' }, db);
  const q = db.calls.find((c) => c.table === 'transport_routes');
  assert.deepEqual(q.gte[0], ['departure_time', '2026-11-26T14:00:00.000Z']);
  assert.deepEqual(q.lte[0], ['departure_time', '2026-11-27T03:59:00.000Z']);
});

test('una ventana en el futuro no se altera', async () => {
  const db = makeDb({ transport_routes: { data: [] }, vehicles: { data: [] }, packages: { data: [] } });
  await run(ADMIN, 'find_available_trips', { date: '2026-11-27', from_time: '15:00', to_time: '17:00' }, db);
  assert.deepEqual(db.calls.find((c) => c.table === 'transport_routes').gte[0], ['departure_time', '2026-11-27T19:00:00.000Z']);
});

test('una ventana que ya terminó no devuelve nada del pasado: las alternativas empiezan ahora', async () => {
  const db = makeDb({ transport_routes: { data: [] }, vehicles: { data: [] }, packages: { data: [] } });
  await run(ADMIN, 'find_available_trips', { date: '2026-11-25', from_time: '08:00', to_time: '10:00' }, db); // ayer
  const calls = db.calls.filter((c) => c.table === 'transport_routes');
  assert.deepEqual(calls[0].gte[0], ['departure_time', '2026-11-26T14:00:00.000Z']);
  assert.deepEqual(calls[1].gte[0], ['departure_time', '2026-11-26T14:00:00.000Z']);
});
