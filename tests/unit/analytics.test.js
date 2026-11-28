import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics, parseRange, getAnalytics, MAX_RANGE_DAYS } from '../../src/modules/statistics/analytics.service.js';
import { analyticsQuerySchema } from '../../src/modules/statistics/statistics.controller.js';

// Bolivia es UTC-4: el día 10 local empieza a las 04:00Z
const at = (day, hh = '12:00') => `2026-03-${String(day).padStart(2, '0')}T${hh}:00Z`;
const RANGE = parseRange({ from: '2026-03-10', to: '2026-03-12' }); // 3 días; el anterior son 3 días (7-9)

const pkg = (id, createdDay, status, extra = {}) => ({ id, status, created_at: at(createdDay), delivered_at: null, route_id: null, ...extra });

test('parseRange: rango inclusivo, duración y período anterior de igual longitud', () => {
  assert.equal(RANGE.days, 3);
  assert.equal(RANGE.prevStart, RANGE.start - 3 * 86400000);
  assert.equal(new Date(RANGE.start).toISOString(), '2026-03-10T04:00:00.000Z');
});

test('parseRange: un solo día es válido; desde > hasta y rangos enormes se rechazan', () => {
  assert.equal(parseRange({ from: '2026-03-10', to: '2026-03-10' }).days, 1);
  assert.throws(() => parseRange({ from: '2026-03-12', to: '2026-03-10' }), (e) => e.status === 400);
  assert.throws(() => parseRange({ from: '2025-01-01', to: '2026-03-10' }), (e) => e.status === 400 && e.message.includes(String(MAX_RANGE_DAYS)));
});

test('parseRange: por defecto son los últimos 30 días', () => {
  const r = parseRange({}, new Date('2026-03-31T15:00:00Z'));
  assert.equal(r.days, 30);
  assert.equal(r.toDay, '2026-03-31');
});

test('sin datos: todo en cero o nulo, nunca inventado', () => {
  const a = buildAnalytics({ packages: [], range: RANGE });
  assert.equal(a.totals.shipments, 0);
  assert.equal(a.totals.onTimePct, null);
  assert.equal(a.totals.avgDeliveryHours, null);
  assert.equal(a.totals.change, null);
  assert.deepEqual(a.statusBreakdown, []);
  assert.deepEqual(a.drivers, []);
  assert.equal(a.trend.length, 3);
  assert.ok(a.trend.every((d) => d.actual === 0 && d.previous === 0));
});

test('volumen: cuenta por día y compara con el período anterior', () => {
  const packages = [
    pkg('a', 10, 'pendiente'), pkg('b', 10, 'asignado'), pkg('c', 12, 'entregado'), // actual
    pkg('x', 8, 'entregado'),                                                          // anterior
    pkg('fuera', 1, 'pendiente'),                                                      // fuera de ambos
  ];
  const a = buildAnalytics({ packages, range: RANGE });
  assert.equal(a.totals.shipments, 3);
  assert.equal(a.totals.previousShipments, 1);
  assert.equal(a.totals.change, 200);
  assert.deepEqual(a.trend.map((d) => d.actual), [2, 0, 1]);
  assert.deepEqual(a.trend.map((d) => d.previous), [0, 1, 0]);
  assert.equal(a.trend[0].date, '10 mar');
});

test('a tiempo: entregado antes de la llegada estimada cuenta; después, no; sin estimación, no se mide', () => {
  const routes = { r1: { id: 'r1', driver_id: 'd1', estimated_arrival: at(11, '18:00') } };
  const packages = [
    pkg('ok', 10, 'entregado', { route_id: 'r1', delivered_at: at(11, '17:00') }),
    pkg('tarde', 10, 'entregado', { route_id: 'r1', delivered_at: at(11, '20:00') }),
    pkg('sin-ruta', 10, 'entregado', { delivered_at: at(11, '10:00') }),
  ];
  const a = buildAnalytics({ packages, routes, range: RANGE });
  assert.equal(a.totals.delivered, 3);
  assert.equal(a.totals.onTimeSample, 2);
  assert.equal(a.totals.onTimePct, 50);
});

test('tiempo medio de entrega en horas', () => {
  const packages = [
    pkg('a', 10, 'entregado', { delivered_at: '2026-03-10T14:00:00Z' }), // creado 12:00 -> 2 h
    pkg('b', 10, 'entregado', { delivered_at: '2026-03-10T16:00:00Z' }), // 4 h
  ];
  assert.equal(buildAnalytics({ packages, range: RANGE }).totals.avgDeliveryHours, 3);
});

test('estado de los envíos y siniestros', () => {
  const packages = [pkg('a', 10, 'siniestro'), pkg('b', 11, 'siniestro'), pkg('c', 11, 'entregado'), pkg('d', 12, 'en_agencia')];
  const a = buildAnalytics({ packages, range: RANGE });
  assert.equal(a.totals.incidents, 2);
  assert.equal(a.statusBreakdown[0].name, 'Siniestro');
  assert.equal(a.statusBreakdown[0].value, 2);
  assert.ok(a.statusBreakdown.some((s) => s.name === 'En agencia'));
});

test('ranking de conductores: entregas reales por conductor, ordenado por eficiencia', () => {
  const routes = {
    r1: { id: 'r1', driver_id: 'd1', estimated_arrival: at(11, '18:00') },
    r2: { id: 'r2', driver_id: 'd2', estimated_arrival: at(11, '18:00') },
  };
  const drivers = { d1: { id: 'd1', full_name: 'Juan Pérez' }, d2: { id: 'd2', full_name: 'Ana Gómez' } };
  const packages = [
    pkg('1', 10, 'entregado', { route_id: 'r1', delivered_at: at(11, '10:00') }),
    pkg('2', 10, 'entregado', { route_id: 'r1', delivered_at: at(11, '11:00') }),
    pkg('3', 10, 'entregado', { route_id: 'r2', delivered_at: at(11, '10:00') }),
    pkg('4', 10, 'entregado', { route_id: 'r2', delivered_at: at(11, '23:00') }), // tarde
    pkg('5', 10, 'asignado', { route_id: 'r2' }),                                  // no entregado: no cuenta
  ];
  const { drivers: ranking } = buildAnalytics({ packages, routes, drivers, range: RANGE });
  assert.deepEqual(ranking.map((d) => [d.name, d.deliveries, d.onTime, d.efficiency]), [
    ['Juan Pérez', 2, 2, 100],
    ['Ana Gómez', 2, 1, 50],
  ]);
});

test('getAnalytics consulta la base y arma el resultado (con base simulada)', async () => {
  const rows = { packages: [pkg('a', 10, 'pendiente')], transport_routes: [], drivers: [] };
  const db = { from: (table) => {
    const b = { select: () => b, gte: () => b, lt: () => b, order: () => b, limit: () => b, in: () => b,
      then: (res, rej) => Promise.resolve({ data: rows[table], error: null }).then(res, rej) };
    return b;
  } };
  const a = await getAnalytics({ from: '2026-03-10', to: '2026-03-12' }, db);
  assert.equal(a.totals.shipments, 1);
});

test('la consulta HTTP valida el formato de fecha', () => {
  assert.doesNotThrow(() => analyticsQuerySchema.parse({ from: '2026-03-01', to: '2026-03-31' }));
  assert.doesNotThrow(() => analyticsQuerySchema.parse({}));
  assert.throws(() => analyticsQuerySchema.parse({ from: '01/03/2026' }));
  assert.throws(() => analyticsQuerySchema.parse({ to: "2026-03-01'; drop table packages;--" }));
});

test('tiempo medio de entrega: una entrega fechada antes de la creación se ignora (no da minutos negativos)', () => {
  const packages = [
    pkg('a', 10, 'entregado', { delivered_at: '2026-03-10T14:00:00Z' }),   // 2 h
    pkg('b', 10, 'entregado', { delivered_at: '2026-03-10T09:00:00Z' }),   // dato inválido: entregado antes de existir
  ];
  assert.equal(buildAnalytics({ packages, range: RANGE }).totals.avgDeliveryHours, 2);
  assert.equal(buildAnalytics({ packages: [packages[1]], range: RANGE }).totals.avgDeliveryHours, null);
});
