import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { custodyLocation, recordCustodyEvent } from '../../src/modules/logistics/logistics.service.js';

// db falso: cada tabla devuelve su fila; guarda lo insertado
const fakeDb = ({ route = null, asOrigin = null, asDest = null, insertError = null } = {}) => {
  const inserted = [];
  return {
    inserted,
    from: (table) => ({
      select: () => {
        const q = { eq: () => q, limit: () => q, maybeSingle: async () => ({ data: table === 'transport_routes' ? route : (q.dest ? asDest : asOrigin) }) };
        const origEq = q.eq;
        q.eq = (col) => { if (col === 'destination_city') q.dest = true; return origEq(); };
        return q;
      },
      insert: async (row) => { inserted.push({ table, row }); return { error: insertError }; },
    }),
  };
};

test('custodyLocation: usa el origen del viaje si el paquete ya tiene uno', async () => {
  const db = fakeDb({ route: { origin_lat: -16.5, origin_lng: -68.1 } });
  assert.deepEqual(await custodyLocation({ route_id: 'r1', origen: 'La Paz' }, db), { lat: -16.5, lng: -68.1 });
});

test('custodyLocation: sin viaje usa la ciudad de origen y, sin ella, (0, 0) como la entrega', async () => {
  assert.deepEqual(await custodyLocation({ origen: 'Oruro' }, fakeDb({ asOrigin: { origin_lat: -17.9, origin_lng: -67.1 } })), { lat: -17.9, lng: -67.1 });
  assert.deepEqual(await custodyLocation({ origen: 'Nowhere' }, fakeDb()), { lat: 0, lng: 0 });
});

test('recordCustodyEvent: guarda quién lo hizo, el estado y la fecha en el historial', async () => {
  const db = fakeDb({ asOrigin: { origin_lat: -17.9, origin_lng: -67.1 } });
  const err = await recordCustodyEvent({ pkg: { id: 'p1', origen: 'Oruro' }, status: 'Pendiente', actor: { id: 'u-admin' }, db });
  assert.equal(err, null);
  const { table, row } = db.inserted[0];
  assert.equal(table, 'tracking_logs');
  assert.equal(row.package_id, 'p1');
  assert.equal(row.status, 'Pendiente');
  assert.equal(row.recorded_by, 'u-admin');
  assert.equal(row.lat, -17.9);
  assert.ok(!Number.isNaN(Date.parse(row.timestamp)));
});

test('recordCustodyEvent: si no se pudo escribir devuelve el error para que quien llama revierta', async () => {
  const db = fakeDb({ insertError: new Error('boom') });
  const err = await recordCustodyEvent({ pkg: { id: 'p1', origen: 'X' }, status: 'Asignado', actor: { id: 'u' }, db });
  assert.equal(err.message, 'boom');
});
