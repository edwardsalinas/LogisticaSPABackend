import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, buildClientAlerts, buildDriverAlerts, planClientAlerts, planDriverAlerts, MAX_ALERTS } from '../../src/modules/ai-agent/ai-agent.alerts.js';

const NOW = Date.parse('2026-11-25T16:00:00Z'); // 12:00 en Bolivia
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const inH = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
const pkg = (id, status, over = {}) => ({ id, tracking_code: `TRK-${id}`, status, origen: 'La Paz', destino: 'Oruro', delivered_at: null, ...over });

// ============================================================ cliente
test('cliente: sin paquetes recientes no hay avisos', () => {
  assert.deepEqual(planClientAlerts({ now: NOW }), []);
  assert.deepEqual(planClientAlerts({ packages: [pkg('1', 'pendiente'), pkg('2', 'asignado')], now: NOW }), []); // aún no salieron: no es noticia
});

test('cliente: «tu paquete llegó» con enlace a su ficha, solo si fue en las últimas 24 horas', () => {
  const [a] = planClientAlerts({ packages: [pkg('1', 'entregado', { delivered_at: ago(2) })], now: NOW });
  assert.equal(a.type, 'client_delivered');
  assert.equal(a.title, '¡Tu paquete llegó!');
  assert.match(a.text, /TRK-1 \(de La Paz a Oruro\) ya fue entregado/);
  assert.deepEqual(a.action, { kind: 'navigate', to: '/logistics/packages/1', label: 'Ver el paquete' });
  assert.deepEqual(planClientAlerts({ packages: [pkg('1', 'entregado', { delivered_at: ago(30) })], now: NOW }), []); // ya es historia
});

test('cliente: «va en camino» lleva al mapa de seguimiento y caduca a las 24 horas del último movimiento', () => {
  const [a] = planClientAlerts({ packages: [pkg('7', 'en_transito')], lastEventAt: { 7: ago(3) }, now: NOW });
  assert.equal(a.type, 'client_in_transit');
  assert.match(a.text, /TRK-7 salió de La Paz rumbo a Oruro/);
  assert.deepEqual(a.action, { kind: 'navigate', to: '/tracking/7/map', label: 'Ver dónde va' });
  assert.deepEqual(planClientAlerts({ packages: [pkg('7', 'en_transito')], lastEventAt: { 7: ago(26) }, now: NOW }), []);
  assert.deepEqual(planClientAlerts({ packages: [pkg('7', 'en_transito')], lastEventAt: {}, now: NOW }), []); // sin movimiento conocido: no se inventa
});

test('cliente: un siniestro es urgencia alta, va primero y no promete nada que Logi no pueda cumplir', () => {
  const alerts = planClientAlerts({
    packages: [pkg('1', 'entregado', { delivered_at: ago(1) }), pkg('2', 'siniestro'), pkg('3', 'en_agencia')],
    lastEventAt: { 2: ago(1), 3: ago(2) }, now: NOW,
  });
  assert.deepEqual(alerts.map((a) => a.type), ['client_incident', 'client_delivered', 'client_in_agency']);
  assert.equal(alerts[0].severity, 'high');
  assert.match(alerts[0].text, /reportó un siniestro\. Revisa su estado y comunícate con la empresa\./);
  assert.doesNotMatch(alerts[0].text, /nos pondremos|te llamaremos|se pondrá en contacto/i);
});

test('cliente: varios paquetes del mismo estado se resumen en un solo aviso', () => {
  const packages = ['1', '2', '3', '4'].map((id) => pkg(id, 'entregado', { delivered_at: ago(1) }));
  const alerts = planClientAlerts({ packages, now: NOW });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, '¡Tus paquetes llegaron!');
  assert.match(alerts[0].text, /4 de tus paquetes ya fueron entregados \(TRK-1, TRK-2 y 2 más\)/);
  assert.deepEqual(alerts[0].action, { kind: 'navigate', to: '/logistics/packages', label: 'Ver mis paquetes' });
});

test('cliente: el identificador cambia con los paquetes y con el estado (un cambio de estado es un aviso nuevo)', () => {
  const a = planClientAlerts({ packages: [pkg('1', 'en_transito')], lastEventAt: { 1: ago(1) }, now: NOW })[0];
  const b = planClientAlerts({ packages: [pkg('1', 'entregado', { delivered_at: ago(1) })], now: NOW })[0];
  const c = planClientAlerts({ packages: [pkg('1', 'en_transito'), pkg('2', 'en_transito')], lastEventAt: { 1: ago(1), 2: ago(1) }, now: NOW })[0];
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(a.id, planClientAlerts({ packages: [pkg('1', 'en_transito')], lastEventAt: { 1: ago(1) }, now: NOW + 60_000 })[0].id); // estable
});

test('cliente: nunca más de MAX_ALERTS', () => {
  const packages = [pkg('1', 'siniestro'), pkg('2', 'entregado', { delivered_at: ago(1) }), pkg('3', 'en_transito'), pkg('4', 'en_agencia')];
  assert.equal(planClientAlerts({ packages, lastEventAt: { 1: ago(1), 3: ago(1), 4: ago(1) }, now: NOW }).length, MAX_ALERTS);
});

// ============================================================ conductor
const route = (id, status, departure, over = {}) => ({ id, origin: 'Oruro', destination: 'La Paz', departure_time: departure, status, ...over });

test('conductor: su viaje sale pronto → aviso con el número de paquetes cargados', () => {
  const [a] = planDriverAlerts({ routes: [route('r1', 'planeada', inH(0.7))], loads: { r1: { total: 3, pending: 3 } }, now: NOW });
  assert.equal(a.type, 'driver_depart');
  assert.equal(a.severity, 'medium');
  assert.equal(a.title, 'Tu viaje sale pronto');
  assert.match(a.text, /viaje de Oruro a La Paz sale hoy a las 12:42 con 3 paquetes cargados\./);
  assert.deepEqual(a.action, { kind: 'navigate', to: '/driver', label: 'Ver mi viaje' });
});

test('conductor: si ya debía haber salido (hasta 1 hora después) es urgencia alta; más lejos o más viejo no es aviso', () => {
  const [late] = planDriverAlerts({ routes: [route('r1', 'planeada', ago(0.5))], now: NOW });
  assert.equal(late.severity, 'high');
  assert.equal(late.title, 'Tu viaje debería haber salido');
  assert.match(late.text, /estaba previsto hoy a las 11:30\./);
  assert.deepEqual(planDriverAlerts({ routes: [route('r1', 'planeada', inH(3))], now: NOW }), []); // falta mucho
  assert.deepEqual(planDriverAlerts({ routes: [route('r1', 'planeada', ago(2))], now: NOW }), []); // ya es historia
});

test('conductor: en tránsito con entregas pendientes → aviso; sin pendientes no hay', () => {
  const one = planDriverAlerts({ routes: [route('r2', 'en_transito', ago(3))], loads: { r2: { total: 4, pending: 1 } }, now: NOW })[0];
  assert.equal(one.type, 'driver_pending');
  assert.match(one.text, /Te queda 1 entrega en el viaje de Oruro a La Paz\./);
  const many = planDriverAlerts({ routes: [route('r2', 'en_transito', ago(3))], loads: { r2: { total: 4, pending: 3 } }, now: NOW })[0];
  assert.match(many.text, /Te quedan 3 entregas/);
  assert.deepEqual(planDriverAlerts({ routes: [route('r2', 'en_transito', ago(3))], loads: { r2: { total: 4, pending: 0 } }, now: NOW }), []);
});

test('conductor: lo urgente va primero', () => {
  const alerts = planDriverAlerts({
    routes: [route('r1', 'en_transito', ago(5)), route('r2', 'planeada', ago(0.2))],
    loads: { r1: { total: 2, pending: 2 }, r2: { total: 1, pending: 1 } }, now: NOW,
  });
  assert.deepEqual(alerts.map((a) => a.type), ['driver_depart', 'driver_pending']);
});

// ============================================================ lectura de la base: solo lo SUYO
const makeDb = (tables) => {
  const calls = [];
  return {
    calls,
    from: (table) => {
      const entry = { table, eq: [], in: [], gte: [], lte: [] };
      calls.push(entry);
      // cada tabla da sus filas ya filtradas por lo que se pidió con eq (p. ej. el estado) y, si traen hora, por la ventana gte/lte
      const rows = () => (tables[table] ?? []).filter((r) => entry.eq.every(([c, v]) => !(c in r) || r[c] === v)
        && entry.gte.every(([c, v]) => !r[c] || Date.parse(r[c]) >= Date.parse(v)) && entry.lte.every(([c, v]) => !r[c] || Date.parse(r[c]) <= Date.parse(v)));
      const b = {
        select: () => b, order: () => b, limit: () => b,
        eq: (c, v) => { entry.eq.push([c, v]); return b; },
        in: (c, v) => { entry.in.push([c, v]); return b; },
        gte: (c, v) => { entry.gte.push([c, v]); return b; },
        lte: (c, v) => { entry.lte.push([c, v]); return b; },
        then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return b;
    },
  };
};

test('buildClientAlerts: pide SOLO los paquetes del cliente (el filtro va en la consulta) y arma el aviso', async () => {
  const db = makeDb({ packages: [pkg('9', 'en_transito')], tracking_logs: [{ package_id: '9', timestamp: ago(1) }] });
  const alerts = await buildClientAlerts({ id: 'cli-1', role: 'client' }, db, NOW);
  assert.deepEqual(db.calls[0].eq, [['sender_id', 'cli-1']]);
  assert.equal(alerts[0].type, 'client_in_transit');
});

test('buildDriverAlerts: pide SOLO los viajes del conductor y cuenta lo que lleva', async () => {
  const db = makeDb({ transport_routes: [route('r5', 'en_transito', ago(2))], packages: [{ route_id: 'r5', status: 'asignado' }, { route_id: 'r5', status: 'entregado' }] });
  const alerts = await buildDriverAlerts({ id: 'drv-1', role: 'driver' }, db, NOW);
  assert.ok(db.calls.filter((c) => c.table === 'transport_routes').every((c) => c.eq.some(([k, v]) => k === 'driver_id' && v === 'drv-1')), 'todas las consultas de viajes filtran por su conductor');
  assert.match(alerts[0].text, /Te queda 1 entrega/);
});

test('buildDriverAlerts: con muchos viajes planeados ANTIGUOS, igual encuentra el que sale en 45 minutos (la ventana va en la consulta)', async () => {
  const old = Array.from({ length: 30 }, (_, i) => route(`old${i}`, 'planeada', ago(24 * (i + 2))));
  const db = makeDb({ transport_routes: [...old, route('soon', 'planeada', inH(0.75))], packages: [{ route_id: 'soon', status: 'asignado' }] });
  const alerts = await buildDriverAlerts({ id: 'drv-1', role: 'driver' }, db, NOW);
  assert.deepEqual(alerts.map((a) => a.type), ['driver_depart']);
  assert.match(alerts[0].text, /con 1 paquete cargado/);
});

test('buildAlerts: cada rol recibe los suyos; un rol desconocido, ninguno; un fallo de la base no rompe nada', async () => {
  const clientDb = makeDb({ packages: [pkg('1', 'entregado', { delivered_at: ago(1) })] });
  assert.equal((await buildAlerts({ id: 'c', role: 'client' }, clientDb, NOW))[0].type, 'client_delivered');
  const driverDb = makeDb({ transport_routes: [route('r1', 'planeada', inH(0.5))] });
  assert.equal((await buildAlerts({ id: 'd', role: 'driver' }, driverDb, NOW))[0].type, 'driver_depart');
  assert.deepEqual(await buildAlerts({ id: 'x', role: 'invitado' }, makeDb({}), NOW), []);
  const broken = { from: () => { throw new Error('caída'); } };
  assert.deepEqual(await buildAlerts({ id: 'c', role: 'client' }, broken, NOW), []);
  assert.deepEqual(await buildAlerts({ id: 'd', role: 'driver' }, broken, NOW), []);
});
