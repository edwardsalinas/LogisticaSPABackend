import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, planAlerts, loadFullTrips, loadIncidents, loadStuckInAgency, MAX_ALERTS } from '../../src/modules/ai-agent/ai-agent.alerts.js';

const NOW = Date.parse('2026-11-25T16:00:00Z'); // 12:00 en Bolivia
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const inH = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
const pkg = (id, status) => ({ id, tracking_code: `TRK-${id}`, status });

// ============================================================ reglas (funciones puras)
test('siniestros: urgencia alta, con el código y enlace a la ficha si es uno solo', () => {
  const [a] = planAlerts({ incidents: [pkg('1', 'siniestro')], now: NOW });
  assert.equal(a.type, 'incident');
  assert.equal(a.severity, 'high');
  assert.equal(a.title, 'Hay paquetes con siniestro');
  assert.match(a.text, /1 paquete con siniestro \(TRK-1\)\. Siguen sin resolverse\./);
  assert.deepEqual(a.action, { kind: 'navigate', to: '/logistics/packages/1', label: 'Ver el paquete' });
});

test('entregas fallidas (devueltos) solos: urgencia media; juntos con siniestros se cuentan en un solo aviso alto', () => {
  const [back] = planAlerts({ incidents: [pkg('2', 'devuelto')], now: NOW });
  assert.equal(back.severity, 'medium');
  assert.equal(back.title, 'Hay entregas fallidas');
  assert.match(back.text, /1 paquete devuelto por una entrega fallida \(TRK-2\)/);
  const [both] = planAlerts({ incidents: [pkg('1', 'siniestro'), pkg('2', 'devuelto'), pkg('3', 'devuelto')], now: NOW });
  assert.equal(both.severity, 'high');
  assert.match(both.text, /1 paquete con siniestro \(TRK-1\) y 2 paquetes devueltos por una entrega fallida \(TRK-2 y TRK-3\)/);
  assert.deepEqual(both.action, { kind: 'navigate', to: '/tracking', label: 'Ver el seguimiento' });
});

test('paquetes parados en agencia: dice cuántos días y se resume si son varios', () => {
  const [one] = planAlerts({ stuck: [{ id: '1', tracking_code: 'TRK-1', hours: 75 }], now: NOW });
  assert.equal(one.type, 'stuck_agency');
  assert.equal(one.severity, 'medium');
  assert.match(one.text, /TRK-1 lleva 3 días en agencia sin moverse/);
  const [many] = planAlerts({ stuck: [{ id: '1', tracking_code: 'TRK-1', hours: 60 }, { id: '2', tracking_code: 'TRK-2', hours: 130 }], now: NOW });
  assert.match(many.text, /2 paquetes llevan más de 2 días en agencia \(el más antiguo, TRK-2, 5 días\)/);
});

const trip = (ref, used, capacity, over = {}) => ({
  ref, origin: 'La Paz', destination: 'Oruro', departure_time: inH(3), capacity_kg: capacity, used_kg: used, free_kg: capacity - used, ...over,
});

test('viaje casi lleno: dice el porcentaje, lo que queda y cuándo sale; pasado de su capacidad es urgencia alta', () => {
  const [a] = planAlerts({ full: [trip('RT-1', 950, 1000)], now: NOW });
  assert.equal(a.type, 'trip_full');
  assert.equal(a.severity, 'medium');
  assert.equal(a.title, 'Un viaje está casi lleno');
  assert.match(a.text, /el viaje de La Paz a Oruro de hoy a las 15:00 lleva 950 kg de 1000 kg \(95 %\): quedan 50 kg\./);
  assert.equal(a.text.includes('RT-1'), false, 'no muestra el identificador del viaje');
  assert.deepEqual(a.action, { kind: 'navigate', to: '/logistics/routes', label: 'Ver los viajes' });
  const [over] = planAlerts({ full: [trip('RT-2', 1100, 1000)], now: NOW });
  assert.equal(over.severity, 'high');
  assert.equal(over.title, 'Un viaje excede su capacidad');
  assert.match(over.text, /se pasa por 100 kg/);
});

test('varios viajes casi llenos se resumen', () => {
  const [a] = planAlerts({ full: [trip('RT-1', 920, 1000), trip('RT-2', 990, 1000)], now: NOW });
  assert.equal(a.title, 'Viajes casi llenos');
  assert.match(a.text, /2 viajes que salen en las próximas 24 horas están al 90 % o más de su capacidad/);
});

test('el orden de urgencia: lo alto primero (retrasos y siniestros), y nunca más de MAX_ALERTS', () => {
  const alerts = planAlerts({
    delayed: [{ id: 'r', origin: 'A', destination: 'B', departure_time: ago(2) }],
    incidents: [pkg('1', 'siniestro')], full: [trip('RT-1', 960, 1000)], stuck: [{ id: '2', tracking_code: 'TRK-2', hours: 80 }],
    noDriver: [{ id: 'n', origin: 'A', destination: 'B', departure_time: inH(5) }],
    group: { route_ref: 'RT-9', origin: 'A', destination: 'B', departure_time: inH(5), packages: [{ tracking_code: 'TRK-9' }], total_kg: 1, free_kg: 100 }, now: NOW,
  });
  assert.equal(alerts.length, MAX_ALERTS);
  assert.deepEqual(alerts.map((a) => a.severity), ['high', 'high', 'medium']);
  assert.deepEqual(alerts.slice(0, 2).map((a) => a.type).sort(), ['delayed', 'incident']);
});

test('sin excepciones nuevas todo sigue igual: sin avisos', () => {
  assert.deepEqual(planAlerts({ incidents: [], stuck: [], full: [], now: NOW }), []);
});

// ============================================================ lectura de la base
const makeDb = (tables) => ({
  from: (table) => {
    const entry = { eq: [], in: [], gte: [], lte: [] };
    const rows = () => (tables[table] ?? []).filter((r) => entry.eq.every(([c, v]) => !(c in r) || r[c] === v)
      && entry.in.every(([c, vs]) => !(c in r) || vs.includes(r[c]))
      && entry.gte.every(([c, v]) => !r[c] || Date.parse(r[c]) >= Date.parse(v)) && entry.lte.every(([c, v]) => !r[c] || Date.parse(r[c]) <= Date.parse(v)));
    const b = {
      select: () => b, order: () => b, limit: () => b, is: () => b, lt: () => b, gt: () => b,
      eq: (c, v) => { entry.eq.push([c, v]); return b; },
      in: (c, v) => { entry.in.push([c, v]); return b; },
      gte: (c, v) => { entry.gte.push([c, v]); return b; },
      lte: (c, v) => { entry.lte.push([c, v]); return b; },
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return b;
  },
});

test('loadIncidents: solo siniestro y devuelto, y de los últimos 30 días', async () => {
  const db = makeDb({ packages: [
    { id: '1', tracking_code: 'TRK-1', status: 'siniestro', created_at: ago(24) },
    { id: '2', tracking_code: 'TRK-2', status: 'devuelto', created_at: ago(24 * 40) }, // demasiado viejo
    { id: '3', tracking_code: 'TRK-3', status: 'entregado', created_at: ago(24) },
  ] });
  assert.deepEqual((await loadIncidents(db, NOW)).map((p) => p.id), ['1']);
});

test('loadStuckInAgency: cuenta desde el ÚLTIMO movimiento, no desde que se creó; entre 2 y 30 días', async () => {
  const db = makeDb({
    packages: [
      { id: 'viejo', tracking_code: 'TRK-V', status: 'en_agencia', created_at: ago(24 * 10) },   // creado hace 10 días pero se movió hace 1
      { id: 'parado', tracking_code: 'TRK-P', status: 'en_agencia', created_at: ago(24 * 10) },  // sin movimiento desde hace 4 días
      { id: 'nuevo', tracking_code: 'TRK-N', status: 'en_agencia', created_at: ago(5) },
      { id: 'antiguo', tracking_code: 'TRK-A', status: 'en_agencia', created_at: ago(24 * 60) },  // más de 30 días: otro problema
      { id: 'otro', tracking_code: 'TRK-O', status: 'en_transito', created_at: ago(24 * 10) },
    ],
    tracking_logs: [
      { package_id: 'viejo', timestamp: ago(24) }, { package_id: 'viejo', timestamp: ago(24 * 9) },
      { package_id: 'parado', timestamp: ago(24 * 4) },
    ],
  });
  const out = await loadStuckInAgency(db, NOW);
  assert.deepEqual(out.map((p) => p.id), ['parado']);
  assert.equal(Math.round(out[0].hours), 96);
});

test('loadFullTrips: solo planeados que salen en 24 h y con el 90 % o más ocupado (por el peso de sus paquetes)', async () => {
  const db = makeDb({
    transport_routes: [
      { id: 'a', route_code: 'RT-A', origin: 'La Paz', destination: 'Oruro', departure_time: inH(3), status: 'planeada', vehicle_id: 'v1' },
      { id: 'b', route_code: 'RT-B', origin: 'La Paz', destination: 'Oruro', departure_time: inH(4), status: 'planeada', vehicle_id: 'v1' },
      { id: 'c', route_code: 'RT-C', origin: 'La Paz', destination: 'Oruro', departure_time: inH(30), status: 'planeada', vehicle_id: 'v1' }, // fuera de la ventana
      { id: 'd', route_code: 'RT-D', origin: 'La Paz', destination: 'Oruro', departure_time: inH(2), status: 'en_transito', vehicle_id: 'v1' }, // ya salió
    ],
    vehicles: [{ id: 'v1', plate: 'ABC-123', brand: 'Volvo', model: 'FH', capacity_kg: 1000 }],
    packages: [{ route_id: 'a', peso: 600 }, { route_id: 'a', peso: 350 }, { route_id: 'b', peso: 300 }, { route_id: 'c', peso: 990 }],
  });
  const full = await loadFullTrips(db, NOW);
  assert.deepEqual(full.map((t) => t.ref), ['RT-A']);
  assert.equal(full[0].used_kg, 950);
});

test('buildAlerts (personal): incluye los nuevos tipos; si una consulta nueva falla, los demás avisos siguen funcionando', async () => {
  const db = makeDb({
    packages: [{ id: '1', tracking_code: 'TRK-1', status: 'siniestro', created_at: ago(24) }],
    transport_routes: [], vehicles: [], tracking_logs: [],
  });
  const types = (await buildAlerts({ id: 'a', role: 'admin' }, db, NOW)).map((a) => a.type);
  assert.ok(types.includes('incident'), types.join(','));
  // un fallo en la consulta de los viajes llenos no rompe nada
  const flaky = { from: (t) => { if (t === 'vehicles') throw new Error('caída'); return db.from(t); } };
  assert.ok((await buildAlerts({ id: 'a', role: 'logistics_operator' }, flaky, NOW)).some((a) => a.type === 'incident'));
});
