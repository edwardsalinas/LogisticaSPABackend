import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, planAlerts, MAX_ALERTS } from '../../src/modules/ai-agent/ai-agent.alerts.js';
import { summarizeLogi, usageReport, recordLogiEvent, LOGI_EVENTS } from '../../src/modules/ai-agent/ai-audit.service.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const at = (hours) => new Date(NOW + hours * 3600 * 1000).toISOString();
const group = (over = {}) => ({
  route_ref: 'RT-1', origin: 'Oruro', destination: 'La Paz', departure_time: at(3), free_kg: 500, total_kg: 20,
  packages: [{ tracking_code: 'TRK-1', peso: 10 }, { tracking_code: 'TRK-2', peso: 10 }], ...over,
});
const route = (id, over = {}) => ({ id, route_code: `RT-${id}`, origin: 'Oruro', destination: 'La Paz', departure_time: at(-2), driver_id: 'd1', ...over });

// ============================================================ reglas (función pura)
test('sin nada anormal no hay avisos', () => {
  assert.deepEqual(planAlerts({ now: NOW }), []);
});

test('paquetes sueltos con viaje: aviso con la acción de preparar la asignación (se confirma como siempre)', () => {
  const [a] = planAlerts({ group: group(), now: NOW });
  assert.equal(a.type, 'assign');
  assert.match(a.text, /2 paquetes sueltos de Oruro a La Paz caben/);
  assert.match(a.text, /20 kg de 500 kg libres/);
  assert.deepEqual(a.action, { kind: 'prepare_assign', route_ref: 'RT-1', codes: ['TRK-1', 'TRK-2'] });
});

test('un viaje que no salió: aviso de urgencia alta con enlace al mapa del viaje', () => {
  const [a] = planAlerts({ delayed: [route('r9')], now: NOW });
  assert.equal(a.type, 'delayed');
  assert.equal(a.severity, 'high');
  assert.match(a.text, /debía salir a las/);
  assert.deepEqual(a.action, { kind: 'navigate', to: '/logistics/routes/r9/map', label: 'Ver el viaje' });
});

test('varios viajes sin salir se resumen en un solo aviso', () => {
  const [a] = planAlerts({ delayed: [route('a'), route('b'), route('c')], now: NOW });
  assert.match(a.text, /^3 viajes debieron salir/);
  assert.equal(a.action.to, '/logistics/routes');
});

test('viajes sin conductor que salen pronto', () => {
  const [a] = planAlerts({ noDriver: [route('n1', { departure_time: at(5), driver_id: null })], now: NOW });
  assert.equal(a.type, 'no_driver');
  assert.match(a.text, /no tiene conductor asignado/);
});

test('se ordenan por urgencia (retraso, oportunidad, conductor) y nunca pasan del máximo', () => {
  const alerts = planAlerts({ group: group(), delayed: [route('d')], noDriver: [route('n', { driver_id: null })], now: NOW });
  assert.deepEqual(alerts.map((x) => x.type), ['delayed', 'assign', 'no_driver']);
  assert.ok(alerts.length <= MAX_ALERTS);
});

test('el identificador es estable (misma situación = mismo aviso) y cambia si cambia la situación', () => {
  const a = planAlerts({ group: group(), now: NOW })[0].id;
  const same = planAlerts({ group: group({ packages: [...group().packages].reverse() }), now: NOW + 60_000 })[0].id;
  const other = planAlerts({ group: group({ packages: [{ tracking_code: 'TRK-9', peso: 1 }] }), now: NOW })[0].id;
  assert.equal(a, same);
  assert.notEqual(a, other);
  assert.match(a, /^assign:[0-9a-f]{12}$/);
});

// ============================================================ lectura de la base (con una base simulada)
const makeDb = ({ routes = [] } = {}) => ({
  from: (table) => {
    const b = {
      select: () => b, is: () => b, eq: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, in: () => b, order: () => b, limit: () => b,
      then: (res, rej) => Promise.resolve({ data: table === 'transport_routes' ? routes : [], error: null }).then(res, rej),
    };
    return b;
  },
});

test('SEGURIDAD: solo administradores y operadores reciben avisos (cliente y conductor: ninguno)', async () => {
  for (const role of ['client', 'driver']) assert.deepEqual(await buildAlerts({ id: 'u', role }, makeDb({ routes: [route('r1')] }), NOW), []);
  const admin = await buildAlerts({ id: 'u', role: 'admin' }, makeDb({ routes: [route('r1')] }), NOW);
  assert.ok(admin.length >= 1);
});

// ============================================================ métricas de Logi
const ev = (event, type) => ({ model: 'logi', tools: type ? [event, type] : [event], user_id: 'u1', status: 'ok', created_at: at(-1) });

test('summarizeLogi: avisos aceptados contra mostrados y acciones hechas contra empezadas', () => {
  const rows = [
    ev('alert_shown', 'assign'), ev('alert_shown', 'assign'), ev('alert_shown', 'delayed'), ev('alert_accepted', 'assign'), ev('alert_snoozed', 'delayed'), ev('alert_muted', 'delayed'),
    ev('guided_started', 'create_package'), ev('guided_started', 'assign_package'), ev('guided_done', 'create_package'), ev('guided_stopped', 'assign_package'), ev('demo_done', 'create_package'),
  ];
  const s = summarizeLogi(rows);
  assert.equal(s.alerts_shown, 3);
  assert.equal(s.alerts_accepted, 1);
  assert.equal(s.alerts_accepted_pct, 33.3);
  assert.equal(s.alerts_snoozed, 1);
  assert.equal(s.alerts_muted, 1);
  assert.equal(s.guided_started, 2);
  assert.equal(s.guided_done_pct, 50);
  assert.equal(s.guided_stopped, 1);
  assert.equal(s.demos, 1);
  assert.deepEqual(s.by_alert_type.find((t) => t.type === 'assign'), { type: 'assign', shown: 2, accepted: 1 });
});

test('summarizeLogi sin eventos no falla (ni divide por cero)', () => {
  const s = summarizeLogi([]);
  assert.equal(s.alerts_accepted_pct, 0);
  assert.equal(s.guided_done_pct, 0);
  assert.deepEqual(s.by_alert_type, []);
});

test('el informe de uso NO cuenta los eventos de Logi como consultas al asistente, y los resume aparte', async () => {
  const rows = [
    { user_id: 'u1', user_role: 'admin', model: 'gemini', tools: [], tokens: 100, latency_ms: 900, fast_path: false, streamed: true, voice: false, status: 'ok', error_status: null, created_at: at(-1) },
    ev('alert_shown', 'assign'), ev('guided_done', 'create_package'),
  ];
  const db = { from: () => { const b = { select: () => b, gte: () => b, order: () => b, limit: () => Promise.resolve({ data: rows, error: null }) }; return b; } };
  const report = await usageReport(db, { days: 7, now: NOW });
  assert.equal(report.totals.queries, 1); // solo la consulta real
  assert.equal(report.totals.active_users, 1);
  assert.equal(report.logi.alerts_shown, 1);
  assert.equal(report.logi.guided_done, 1);
});

test('recordLogiEvent guarda solo el nombre del evento y su tipo (sin contenido) y nunca lanza', async () => {
  const inserted = [];
  const db = { from: () => ({ insert: async (row) => { inserted.push(row); return { error: null }; } }) };
  await recordLogiEvent(db, { userId: 'u1', role: 'admin', event: 'alert_accepted', type: 'assign' });
  assert.deepEqual(inserted[0], { user_id: 'u1', user_role: 'admin', model: 'logi', tools: ['alert_accepted', 'assign'], status: 'ok' });
  const broken = { from: () => ({ insert: async () => { throw new Error('caída de la base'); } }) };
  await assert.doesNotReject(() => recordLogiEvent(broken, { userId: 'u1', role: 'admin', event: 'alert_shown' }));
  assert.ok(LOGI_EVENTS.includes('demo_done') && LOGI_EVENTS.includes('alert_muted'));
});
