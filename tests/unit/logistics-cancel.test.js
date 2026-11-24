import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelNewPackage } from '../../src/modules/logistics/logistics.service.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const makeDb = (pkg) => {
  const state = { pkg: pkg ? { ...pkg } : null, logs: [] };
  const from = (table) => {
    const q = { patch: null };
    const b = {
      select: () => b, limit: () => b, eq: () => b,
      update: (patch) => { q.patch = patch; return b; },
      insert: async (row) => { if (table === 'tracking_logs') state.logs.push(row); return { error: null }; },
      single: async () => { if (q.patch) state.pkg = { ...state.pkg, ...q.patch }; return { data: state.pkg, error: null }; },
      maybeSingle: async () => ({ data: table === 'packages' ? state.pkg : null, error: null }),
      then: (res, rej) => { if (q.patch && table === 'packages') state.pkg = { ...state.pkg, ...q.patch }; return Promise.resolve({ data: null, error: null }).then(res, rej); },
    };
    return b;
  };
  return { db: { from }, state };
};
const FRESH = { id: 'p1', tracking_code: 'TRK-1', status: 'pendiente', route_id: null, created_at: '2026-11-24T11:30:00Z', origen: 'Oruro', destino: 'La Paz' };

test('anular un paquete recién creado: queda «cancelado» (no se borra) y con constancia de quién lo hizo', async () => {
  const { db, state } = makeDb(FRESH);
  const out = await cancelNewPackage('p1', { actor: { id: 'u1' }, db, now: NOW });
  assert.equal(out.status, 'cancelado');
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].status, 'Cancelado');
  assert.equal(state.logs[0].recorded_by, 'u1');
  assert.match(state.logs[0].observations, /deshecha/);
});

test('NO se anula si ya se asignó, salió, se entregó o tiene viaje → 409 y nada cambia', async () => {
  for (const p of [{ status: 'asignado', route_id: 'r1' }, { status: 'en_transito' }, { status: 'entregado' }, { status: 'pendiente', route_id: 'r1' }]) {
    const { db, state } = makeDb({ ...FRESH, ...p });
    await assert.rejects(() => cancelNewPackage('p1', { db, now: NOW }), (e) => e.status === 409);
    assert.equal(state.pkg.status, p.status);
    assert.equal(state.logs.length, 0);
  }
});

test('NO se anula pasadas 2 horas desde su creación → 409', async () => {
  const { db, state } = makeDb({ ...FRESH, created_at: '2026-11-24T09:00:00Z' });
  await assert.rejects(() => cancelNewPackage('p1', { db, now: NOW }), (e) => e.status === 409 && /2 horas/.test(e.message));
  assert.equal(state.pkg.status, 'pendiente');
});

test('un paquete que no existe → 404', async () => {
  const { db } = makeDb(null);
  await assert.rejects(() => cancelNewPackage('zzz', { db, now: NOW }), (e) => e.status === 404);
});
