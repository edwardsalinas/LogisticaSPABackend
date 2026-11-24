import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unassignPackageFromRoute } from '../../src/modules/logistics/logistics.service.js';

/** Base simulada: tablas en memoria con el subconjunto de la API de Supabase que usa la función. */
const makeDb = ({ pkg, route }) => {
  const state = { pkg: pkg ? { ...pkg } : null, logs: [] };
  const from = (table) => {
    const q = { table, filters: {}, patch: null, insert: null };
    const b = {
      select: () => b,
      limit: () => b,
      eq: (k, v) => { q.filters[k] = v; return b; },
      update: (patch) => { q.patch = patch; return b; },
      insert: async (row) => { if (table === 'tracking_logs') state.logs.push(row); return { error: null }; },
      single: async () => {
        if (q.patch && table === 'packages') state.pkg = { ...state.pkg, ...q.patch };
        return { data: state.pkg, error: null };
      },
      maybeSingle: async () => ({ data: table === 'packages' ? state.pkg : table === 'transport_routes' ? route : null, error: null }),
      then: (res, rej) => {
        if (q.patch && table === 'packages') state.pkg = { ...state.pkg, ...q.patch };
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { db: { from }, state };
};

const ASSIGNED = { id: 'p1', tracking_code: 'TRK-1', status: 'asignado', route_id: 'r1', origen: 'Oruro', destino: 'La Paz' };

test('deshacer una asignación: el paquete vuelve a pendiente, sin viaje, y queda constancia de quién lo deshizo', async () => {
  const { db, state } = makeDb({ pkg: ASSIGNED, route: { status: 'planeada' } });
  const out = await unassignPackageFromRoute('p1', { actor: { id: 'u1', role: 'admin' }, db });
  assert.equal(out.status, 'pendiente');
  assert.equal(out.route_id, null);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].status, 'Pendiente');
  assert.equal(state.logs[0].recorded_by, 'u1');
  assert.match(state.logs[0].observations, /deshecha/);
});

test('NO se puede deshacer si el paquete ya no está «asignado» (en tránsito, entregado, pendiente…) → 409', async () => {
  for (const status of ['en_transito', 'entregado', 'pendiente', 'cancelado']) {
    const { db, state } = makeDb({ pkg: { ...ASSIGNED, status }, route: { status: 'planeada' } });
    await assert.rejects(() => unassignPackageFromRoute('p1', { db }), (e) => e.status === 409);
    assert.equal(state.pkg.status, status, 'no se tocó');
    assert.equal(state.logs.length, 0);
  }
});

test('NO se puede deshacer si el viaje ya salió → 409 y el paquete no cambia', async () => {
  const { db, state } = makeDb({ pkg: ASSIGNED, route: { status: 'en_transito' } });
  await assert.rejects(() => unassignPackageFromRoute('p1', { db }), (e) => e.status === 409 && /ya salió/.test(e.message));
  assert.equal(state.pkg.route_id, 'r1');
});

test('un paquete que no existe → 404', async () => {
  const { db } = makeDb({ pkg: null, route: null });
  await assert.rejects(() => unassignPackageFromRoute('nada', { db }), (e) => e.status === 404);
});
