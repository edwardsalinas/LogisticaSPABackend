import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { withEstimates, createRoute } from '../../src/modules/logistics/logistics.service.js';

// predefined_routes simulada: registra los filtros eq() y devuelve el tramo (o nada)
const dbWith = (tramo) => {
  const filters = {};
  const db = {
    filters,
    from: (table) => {
      filters.table = table;
      const b = {
        select: () => b,
        eq: (col, val) => { filters[col] = val; return b; },
        limit: () => b,
        maybeSingle: async () => ({ data: tramo, error: null }),
      };
      return b;
    },
    rpc: async (fn, args) => { db.lastRpc = { fn, args }; return { data: { id: 'r1' }, error: null }; },
  };
  return db;
};

const DEPARTURE = '2026-11-21T22:00:00.000Z';
const BASE = { origin: 'La Paz', destination: 'Oruro', departure_time: DEPARTURE };

test('con un tramo predefinido, calcula distancia, duración y llegada estimada', async () => {
  const db = dbWith({ estimated_km: 230, estimated_minutes: 240 });
  const out = await withEstimates(BASE, db);
  assert.equal(out.total_distance_km, 230);
  assert.equal(out.estimated_duration_minutes, 240);
  assert.equal(out.estimated_arrival, '2026-11-22T02:00:00.000Z'); // salida + 4 h
  assert.deepEqual([db.filters.table, db.filters.origin_city, db.filters.destination_city], ['predefined_routes', 'La Paz', 'Oruro']);
});

test('sin tramo conocido no inventa nada', async () => {
  const out = await withEstimates(BASE, dbWith(null));
  assert.equal(out.estimated_arrival, undefined);
  assert.equal(out.estimated_duration_minutes, undefined);
});

test('un tramo sin duración válida no genera llegada estimada', async () => {
  for (const estimated_minutes of [null, 0, -5, 'abc']) {
    const out = await withEstimates(BASE, dbWith({ estimated_km: 10, estimated_minutes }));
    assert.equal(out.estimated_arrival, undefined, `duración ${estimated_minutes}`);
  }
});

test('respeta los valores que ya trae la ruta (no los pisa)', async () => {
  const given = { ...BASE, estimated_duration_minutes: 90, estimated_arrival: '2026-11-21T23:30:00.000Z' };
  const db = dbWith({ estimated_km: 230, estimated_minutes: 240 });
  assert.deepEqual(await withEstimates(given, db), given);
  assert.equal(db.filters.table, undefined); // ni siquiera consulta
});

test('sin origen, destino o salida no consulta ni cambia la ruta', async () => {
  const db = dbWith({ estimated_km: 230, estimated_minutes: 240 });
  assert.deepEqual(await withEstimates({ origin: 'La Paz' }, db), { origin: 'La Paz' });
  assert.equal(db.filters.table, undefined);
});

test('createRoute envía la llegada estimada a la función atómica', async () => {
  const db = dbWith({ estimated_km: 230, estimated_minutes: 240 });
  await createRoute({ ...BASE, driver_id: 'd1' }, db);
  assert.equal(db.lastRpc.fn, 'create_route_with_checkpoints');
  assert.equal(db.lastRpc.args.p_route.estimated_arrival, '2026-11-22T02:00:00.000Z');
  assert.equal(db.lastRpc.args.p_route.status, 'planeada');
});
