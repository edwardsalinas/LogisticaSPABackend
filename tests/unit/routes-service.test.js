import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoute, updateRoute, deleteRoute } from '../../src/modules/logistics/logistics.service.js';

/** Cliente de Supabase simulado: registra las llamadas y permite definir la respuesta de rpc() */
const makeDb = (rpc) => {
  const calls = [];
  const db = {
    calls,
    rpc: async (fn, args) => {
      calls.push({ type: 'rpc', fn, args });
      return rpc(fn, args);
    },
    from: (table) => {
      const builder = {
        insert: (row) => { calls.push({ type: 'insert', table, row }); return builder; },
        update: (row) => { calls.push({ type: 'update', table, row }); return builder; },
        delete: () => { calls.push({ type: 'delete', table }); return builder; },
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        single: async () => ({ data: { id: 'r1', origin: 'A', destination: 'B' }, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
  return db;
};

const MISSING = { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' };
const DATA = { origin: 'La Paz', destination: 'Oruro', driver_id: 'd1', checkpoints: [{ name: 'P1', lat: -16, lng: -68, sequence_order: 1 }] };

test('createRoute usa la función atómica (una sola llamada) y fuerza el estado planeada', async () => {
  const db = makeDb(async () => ({ data: { id: 'r1' }, error: null }));
  const route = await createRoute(DATA, db);

  assert.deepEqual(route, { id: 'r1' });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].fn, 'create_route_with_checkpoints');
  assert.equal(db.calls[0].args.p_route.status, 'planeada');
  assert.equal('checkpoints' in db.calls[0].args.p_route, false);
  assert.equal(db.calls[0].args.p_checkpoints.length, 1);
});

test('createRoute propaga los errores reales sin ocultarlos con el flujo secuencial', async () => {
  const db = makeDb(async () => ({ data: null, error: { code: '22023', message: 'La ruta no contiene columnas válidas' } }));
  await assert.rejects(createRoute(DATA, db), (e) => e.code === '22023');
  assert.equal(db.calls.some((c) => c.type === 'insert'), false); // no hubo respaldo: no se duplicó nada
});

test('createRoute: si las funciones no están instaladas, usa el flujo secuencial', async () => {
  const db = makeDb(async () => ({ data: null, error: MISSING }));
  const route = await createRoute(DATA, db);

  assert.equal(route.id, 'r1');
  const inserts = db.calls.filter((c) => c.type === 'insert');
  assert.deepEqual(inserts.map((c) => c.table), ['transport_routes', 'route_checkpoints']);
  assert.equal(inserts[1].row[0].route_id, 'r1');
});

test('updateRoute: sin checkpoints envía null (no tocarlos) y con [] envía [] (eliminarlos)', async () => {
  const db = makeDb(async () => ({ data: { id: 'r1' }, error: null }));
  await updateRoute('r1', { origin: 'X' }, db);
  await updateRoute('r1', { origin: 'X', checkpoints: [] }, db);

  assert.equal(db.calls[0].fn, 'update_route_with_checkpoints');
  assert.equal(db.calls[0].args.p_id, 'r1');
  assert.equal(db.calls[0].args.p_checkpoints, null);
  assert.deepEqual(db.calls[1].args.p_checkpoints, []);
});

test('updateRoute: respaldo secuencial cuando la función no existe (código 42883)', async () => {
  const db = makeDb(async () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }));
  const route = await updateRoute('r1', { origin: 'X' }, db);
  assert.equal(route.id, 'r1');
  assert.ok(db.calls.some((c) => c.type === 'update' && c.table === 'transport_routes'));
});

test('deleteRoute: función atómica y respaldo secuencial', async () => {
  const ok = makeDb(async () => ({ data: true, error: null }));
  assert.equal(await deleteRoute('r1', ok), true);
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].fn, 'delete_route_cascade');

  const fallback = makeDb(async () => ({ data: null, error: MISSING }));
  assert.equal(await deleteRoute('r1', fallback), true);
  assert.ok(fallback.calls.some((c) => c.type === 'delete' && c.table === 'transport_routes'));

  const failing = makeDb(async () => ({ data: null, error: { code: 'P0002', message: 'Ruta no encontrada' } }));
  await assert.rejects(deleteRoute('x', failing), (e) => e.message === 'Ruta no encontrada' && e.code === 'P0002');
});
