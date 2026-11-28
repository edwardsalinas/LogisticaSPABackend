import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPackageSearch, getPackageForUser, getPackages, PACKAGES_DEFAULT_LIMIT, PACKAGES_MAX_LIMIT } from '../../src/modules/logistics/logistics.service.js';

/** Base simulada que registra lo que se le pide (select, order, eq, or, range) y devuelve filas fijas. */
const fakeDb = (rows = [], single = null) => {
  const log = { eq: [], or: [], range: null, select: null, order: null, table: null };
  const b = {
    select: (c) => { log.select = c; return b; },
    order: (c, o) => { log.order = [c, o]; return b; },
    eq: (c, v) => { log.eq.push([c, v]); return b; },
    or: (expr) => { log.or.push(expr); return b; },
    range: (a, z) => { log.range = [a, z]; return b; },
    maybeSingle: async () => ({ data: single, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return { from: (t) => { log.table = t; return b; }, log };
};

test('lista: por defecto 50 por página, del más nuevo al más antiguo (como antes)', async () => {
  const db = fakeDb([{ id: 1 }]);
  assert.deepEqual(await getPackages({}, db), [{ id: 1 }]);
  assert.deepEqual(db.log.range, [0, PACKAGES_DEFAULT_LIMIT - 1]);
  assert.deepEqual(db.log.order, ['created_at', { ascending: false }]);
});

test('lista: limit y page se pueden pedir, con tope, y un valor raro vuelve al valor por defecto', async () => {
  let db = fakeDb(); await getPackages({ limit: '200', page: '2' }, db); assert.deepEqual(db.log.range, [200, 399]);
  db = fakeDb(); await getPackages({ limit: '999999' }, db); assert.deepEqual(db.log.range, [0, PACKAGES_MAX_LIMIT - 1]);
  db = fakeDb(); await getPackages({ limit: '-5', page: '0' }, db); assert.deepEqual(db.log.range, [0, 0]);
  db = fakeDb(); await getPackages({ limit: 'abc', page: 'x' }, db); assert.deepEqual(db.log.range, [0, PACKAGES_DEFAULT_LIMIT - 1]);
});

test('lista: la búsqueda mira código, destinatario, remitente, origen y destino, y se limpia (sin comas ni comodines)', async () => {
  const db = fakeDb();
  await getPackages({ search: "TRK-123,status.eq.x) %_ O'Brien" }, db);
  assert.equal(db.log.or.length, 1);
  const expr = db.log.or[0];
  for (const c of ['tracking_code', 'recipient_name', 'sender_name', 'origen', 'destino']) assert.match(expr, new RegExp(`${c}\.ilike\.`));
  assert.equal(cleanPackageSearch("TRK-123,status.eq.x) %_ O'Brien"), "TRK-123 status eq x O'Brien");
  assert.equal(expr.split(',').length, 5, 'una condición por columna: el texto del usuario no agrega condiciones');
});

test('lista: sin búsqueda no agrega condiciones, y status / sender_id siguen filtrando', async () => {
  const db = fakeDb();
  await getPackages({ status: 'pendiente', sender_id: 'u1', search: '   ' }, db);
  assert.deepEqual(db.log.or, []);
  assert.deepEqual(db.log.eq, [['status', 'pendiente'], ['sender_id', 'u1']]);
});

const UUID = '275100fc-cee8-41fc-8dbc-e551975e961e';
const pkg = (o = {}) => ({ id: UUID, tracking_code: 'TRK-1', sender_id: 'cliente-1', transport_routes: { departure_time: 'x', driver_id: 'chofer-1' }, ...o });

test('ficha: el personal ve cualquier paquete y no se expone el conductor del viaje', async () => {
  const out = await getPackageForUser(UUID, { id: 'a', role: 'admin' }, fakeDb([], pkg()));
  assert.equal(out.tracking_code, 'TRK-1');
  assert.deepEqual(out.transport_routes, { departure_time: 'x' });
});

test('ficha: el cliente solo ve los suyos; el conductor solo los de sus viajes (si no, es como si no existiera)', async () => {
  assert.ok(await getPackageForUser(UUID, { id: 'cliente-1', role: 'client' }, fakeDb([], pkg())));
  assert.equal(await getPackageForUser(UUID, { id: 'cliente-2', role: 'client' }, fakeDb([], pkg())), null);
  assert.ok(await getPackageForUser(UUID, { id: 'chofer-1', role: 'driver' }, fakeDb([], pkg())));
  assert.equal(await getPackageForUser(UUID, { id: 'chofer-2', role: 'driver' }, fakeDb([], pkg())), null);
  assert.equal(await getPackageForUser(UUID, { id: 'chofer-1', role: 'driver' }, fakeDb([], pkg({ transport_routes: null }))), null); // sin viaje: no es suyo
});

test('ficha: un id que no es UUID o que no existe responde null sin consultar nada raro', async () => {
  const db = fakeDb([], null);
  assert.equal(await getPackageForUser('no-es-uuid', { role: 'admin' }, db), null);
  assert.equal(db.log.table, null, 'ni siquiera consulta la base con un id inválido');
  assert.equal(await getPackageForUser(UUID, { role: 'admin' }, fakeDb([], null)), null);
  assert.equal(await getPackageForUser(undefined, { role: 'admin' }, db), null);
});
