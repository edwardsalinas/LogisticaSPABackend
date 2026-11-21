import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { logEvent, packageStatusFromEvent } from '../../src/modules/tracking/tracking.service.js';
import { deliverPackage } from '../../src/modules/logistics/logistics.service.js';
import { deliverBodySchema } from '../../src/modules/logistics/logistics.controller.js';
import { PACKAGE_STATUS } from '../../src/modules/logistics/logistics.schema.js';

/**
 * Base de datos simulada con estado: soporta select/eq/single/maybeSingle, insert y update,
 * y registra cada escritura para poder comprobarla.
 */
const fakeDb = ({ packages = [], routes = [], failLogInsert = false } = {}) => {
  const state = { packages: packages.map((p) => ({ ...p })), routes, logs: [], updates: [] };
  const from = (table) => {
    let filter = null;
    let pendingUpdate = null;
    const rows = () => (table === 'packages' ? state.packages : table === 'transport_routes' ? state.routes : []);
    const pick = () => rows().find((r) => !filter || r[filter.col] === filter.val) ?? null;
    const b = {
      select: () => b,
      eq: (col, val) => { filter = { col, val }; return b; },
      single: async () => {
        const r = pick();
        if (r && pendingUpdate) { Object.assign(r, pendingUpdate); state.updates.push({ table, values: pendingUpdate }); pendingUpdate = null; }
        return r ? { data: { ...r }, error: null } : { data: null, error: { message: 'no encontrado' } }; // copia, como hace Supabase
      },
      maybeSingle: async () => { const r = pick(); return { data: r ? { ...r } : null, error: null }; },
      insert: (row) => {
        const failed = table === 'tracking_logs' && failLogInsert;
        if (table === 'tracking_logs' && !failed) state.logs.push(...[].concat(row));
        const result = failed ? { error: { message: 'fallo al insertar' } } : { data: row, error: null };
        return {
          select: async () => ({ data: [].concat(row).map((r, i) => ({ id: `log${i}`, ...r })), error: result.error ?? null }),
          then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
        };
      },
      update: (values) => { pendingUpdate = values; return b; },
      then: (resolve, reject) => {
        // update(...).eq(...) se resuelve al esperar el builder
        if (pendingUpdate) {
          const r = pick();
          if (r) Object.assign(r, pendingUpdate);
          state.updates.push({ table, values: pendingUpdate });
          return Promise.resolve({ data: r, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    // update(...).eq(...).select().single()
    const baseEq = b.eq;
    b.eq = (col, val) => { baseEq(col, val); return b; };
    return b;
  };
  return { from, state };
};

const PKG = { id: 'p1', status: 'asignado', route_id: 'r1' };
const ROUTE = { id: 'r1', driver_id: 'd1', dest_lat: -17.39, dest_lng: -66.15 };

// ------------------------------------------------------------------ RF02: estados
test('RF02: PACKAGE_STATUS incluye En agencia y Siniestro', () => {
  assert.equal(PACKAGE_STATUS.AT_AGENCY, 'en_agencia');
  assert.equal(PACKAGE_STATUS.INCIDENT, 'siniestro');
});

test('RF02: los textos de un evento se asocian al estado del paquete (con tildes, mayúsculas y alias)', () => {
  assert.equal(packageStatusFromEvent('En Agencia'), 'en_agencia');
  assert.equal(packageStatusFromEvent('SINIESTRO'), 'siniestro');
  assert.equal(packageStatusFromEvent('En Tránsito'), 'en_transito');
  assert.equal(packageStatusFromEvent('in_transit'), 'en_transito');
  assert.equal(packageStatusFromEvent('Entró en tránsito: La Paz'), null); // texto libre del GPS: no cambia el paquete
  assert.equal(packageStatusFromEvent(undefined), null);
});

test('RF02: un evento "siniestro" cambia el estado del paquete', async () => {
  const db = fakeDb({ packages: [PKG] });
  await logEvent({ package_id: 'p1', lat: 1, lng: 2, status: 'Siniestro' }, { id: 'u1' }, db);
  assert.equal(db.state.packages[0].status, 'siniestro');
});

// ------------------------------------------------------------------ RF03: cadena de custodia
test('RF03: cada evento registra el usuario responsable', async () => {
  const captured = [];
  const db = { from: () => ({ insert: (rows) => { captured.push(...rows); return { select: async () => ({ data: rows.map((r) => ({ id: 'x', ...r })), error: null }) }; }, update: () => ({ eq: async () => ({ error: null }) }) }) };
  await logEvent({ package_id: 'p1', lat: 1, lng: 2, status: 'En agencia', observations: 'Llegó a la agencia El Alto' }, { id: 'user-123' }, db);
  assert.equal(captured[0].recorded_by, 'user-123');
  assert.equal(captured[0].observations, 'Llegó a la agencia El Alto');
});

test('RF03: sin usuario asociado queda null (no se inventa un responsable)', async () => {
  const captured = [];
  const db = { from: () => ({ insert: (rows) => { captured.push(...rows); return { select: async () => ({ data: [{ id: 'x' }], error: null }) }; } }) };
  await logEvent({ package_id: 'p1', lat: 1, lng: 2, status: 'Pendiente' }, null, db);
  assert.equal(captured[0].recorded_by, null);
});

// ------------------------------------------------------------------ HU02: entrega
test('HU02: un conductor NO puede entregar un paquete de la ruta de otro conductor', async () => {
  const db = fakeDb({ packages: [PKG], routes: [ROUTE] });
  await assert.rejects(() => deliverPackage('p1', { user: { id: 'd2', role: 'driver' } }, db), (e) => e.status === 403);
  assert.equal(db.state.packages[0].status, 'asignado'); // no cambió
  assert.equal(db.state.logs.length, 0);
});

test('HU02: un conductor no puede entregar un paquete sin ruta asignada', async () => {
  const db = fakeDb({ packages: [{ id: 'p1', status: 'pendiente', route_id: null }] });
  await assert.rejects(() => deliverPackage('p1', { user: { id: 'd1', role: 'driver' } }, db), (e) => e.status === 403);
});

test('HU02: el conductor de la ruta entrega, con nota, y queda constancia con su id (RF03)', async () => {
  const db = fakeDb({ packages: [PKG], routes: [ROUTE] });
  await deliverPackage('p1', { user: { id: 'd1', role: 'driver' }, note: 'Recibió la señora Mamani' }, db);
  assert.equal(db.state.packages[0].status, 'entregado');
  assert.ok(db.state.packages[0].delivered_at);
  assert.equal(db.state.logs.length, 1);
  assert.equal(db.state.logs[0].status, 'Entregado');
  assert.equal(db.state.logs[0].observations, 'Recibió la señora Mamani');
  assert.equal(db.state.logs[0].recorded_by, 'd1');
  assert.equal(db.state.logs[0].lat, -17.39); // sin GPS: usa el destino de la ruta
});

test('HU02: la ubicación reportada tiene prioridad sobre el destino de la ruta', async () => {
  const db = fakeDb({ packages: [PKG], routes: [ROUTE] });
  await deliverPackage('p1', { user: { id: 'd1', role: 'driver' }, lat: -16.5, lng: -68.1 }, db);
  assert.deepEqual([db.state.logs[0].lat, db.state.logs[0].lng], [-16.5, -68.1]);
});

test('HU02: admin y operador pueden entregar cualquier paquete', async () => {
  for (const role of ['admin', 'logistics_operator']) {
    const db = fakeDb({ packages: [PKG], routes: [ROUTE] });
    await deliverPackage('p1', { user: { id: 'x', role } }, db);
    assert.equal(db.state.packages[0].status, 'entregado');
  }
});

test('HU02: un paquete ya entregado es idempotente (no duplica el historial)', async () => {
  const db = fakeDb({ packages: [{ ...PKG, status: 'entregado' }], routes: [ROUTE] });
  await deliverPackage('p1', { user: { id: 'd1', role: 'driver' } }, db);
  assert.equal(db.state.logs.length, 0);
});

test('HU02: un paquete cancelado o devuelto no se puede entregar', async () => {
  for (const status of ['cancelado', 'devuelto']) {
    const db = fakeDb({ packages: [{ ...PKG, status }], routes: [ROUTE] });
    await assert.rejects(() => deliverPackage('p1', { user: { id: 'd1', role: 'driver' } }, db), (e) => e.status === 409);
  }
});

test('HU02: si no se puede dejar constancia en el historial, se revierte la entrega', async () => {
  const db = fakeDb({ packages: [PKG], routes: [ROUTE], failLogInsert: true });
  await assert.rejects(() => deliverPackage('p1', { user: { id: 'd1', role: 'driver' } }, db));
  assert.equal(db.state.packages[0].status, 'asignado');
  assert.equal(db.state.packages[0].delivered_at, null);
});

test('HU02: el cuerpo de la entrega se valida (nota máx. 500, coordenadas válidas)', () => {
  assert.deepEqual(deliverBodySchema.parse({}), {});
  assert.equal(deliverBodySchema.parse({ note: '  ok  ' }).note, 'ok');
  assert.throws(() => deliverBodySchema.parse({ note: 'x'.repeat(501) }));
  assert.throws(() => deliverBodySchema.parse({ lat: 200, lng: 0 }));
});
