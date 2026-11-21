import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Pruebas de las funciones SQL de migrations/019 y de migrations/018 contra un PostgreSQL real
 * (PGlite: PostgreSQL compilado a WebAssembly, no necesita servidor ni red).
 * El esquema de apoyo reproduce solo las columnas que usan las funciones.
 */
const MIGRATIONS = path.resolve('migrations');
const sql = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

const SCHEMA = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE TABLE transport_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_code TEXT DEFAULT 'RT-AUTO',
    origin TEXT, destination TEXT,
    origin_lat DOUBLE PRECISION, origin_lng DOUBLE PRECISION, dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
    driver_id UUID, vehicle_id UUID,
    departure_time TIMESTAMPTZ,
    status TEXT DEFAULT 'planeada',
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE route_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES transport_routes(id),
    name TEXT NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL,
    sequence_order INT NOT NULL, radius_meters INT DEFAULT 100
  );
  CREATE TABLE packages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID REFERENCES transport_routes(id), status TEXT);
  CREATE TABLE driver_trips (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID REFERENCES transport_routes(id));
  CREATE TABLE tracking_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trip_id UUID REFERENCES driver_trips(id), status TEXT);
  CREATE TABLE checkpoint_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id UUID NOT NULL REFERENCES route_checkpoints(id),
    trip_id UUID REFERENCES driver_trips(id)
  );
`;

let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(sql('019_route_atomic_operations.sql'));
});
test.after(async () => db.close());

const count = async (table) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const call = (fn, params = []) => db.query(`SELECT ${fn} AS result`, params);

const CP = (n, extra = {}) => ({ name: `Punto ${n}`, lat: -16 - n / 10, lng: -68 - n / 10, sequence_order: n, ...extra });

test('create_route_with_checkpoints: crea la ruta y sus checkpoints; usa los valores por defecto', async () => {
  const { rows } = await call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
    JSON.stringify({ origin: 'La Paz', destination: 'Oruro', status: 'planeada', departure_time: '2026-04-01T10:00:00Z' }),
    JSON.stringify([CP(1), CP(2, { radius_meters: 250 })]),
  ]);
  const route = rows[0].result;
  assert.equal(route.origin, 'La Paz');
  assert.equal(route.route_code, 'RT-AUTO'); // columna ausente en el JSON: conserva su valor por defecto
  assert.ok(route.id);

  const cps = (await db.query('SELECT name, radius_meters FROM route_checkpoints WHERE route_id = $1 ORDER BY sequence_order', [route.id])).rows;
  assert.deepEqual(cps.map((c) => c.name), ['Punto 1', 'Punto 2']);
  assert.deepEqual(cps.map((c) => c.radius_meters), [100, 250]); // 100 por defecto
});

test('create_route_with_checkpoints: es atómica, un checkpoint inválido no deja la ruta a medias', async () => {
  const before = await count('transport_routes');
  await assert.rejects(
    call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
      JSON.stringify({ origin: 'A', destination: 'B' }),
      JSON.stringify([CP(1), { name: 'Roto', lat: 'no-es-numero', lng: 1, sequence_order: 2 }]),
    ])
  );
  assert.equal(await count('transport_routes'), before);
});

test('create_route_with_checkpoints: ignora claves que no son columnas (sin inyección SQL)', async () => {
  const before = await count('transport_routes');
  await call('create_route_with_checkpoints($1::jsonb)', [
    JSON.stringify({ origin: 'A', destination: 'B', 'id); DROP TABLE packages;--': 'x', inexistente: 1, id: '00000000-0000-0000-0000-000000000000' }),
  ]);
  assert.equal(await count('transport_routes'), before + 1);
  assert.notEqual((await db.query("SELECT to_regclass('public.packages') AS t")).rows[0].t, null); // la tabla sigue existiendo
  const ids = (await db.query("SELECT id FROM transport_routes WHERE id = '00000000-0000-0000-0000-000000000000'")).rows;
  assert.equal(ids.length, 0); // el id nunca se toma del JSON
});

test('create_route_with_checkpoints: rechaza un JSON sin columnas válidas', async () => {
  await assert.rejects(call('create_route_with_checkpoints($1::jsonb)', [JSON.stringify({ inexistente: 1 })]), /columnas válidas/);
});

test('update_route_with_checkpoints: actualiza campos y reemplaza los checkpoints', async () => {
  const created = (await call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
    JSON.stringify({ origin: 'La Paz', destination: 'Oruro' }), JSON.stringify([CP(1), CP(2)]),
  ])).rows[0].result;

  const updated = (await call('update_route_with_checkpoints($1::uuid, $2::jsonb, $3::jsonb)', [
    created.id, JSON.stringify({ destination: 'Potosí', status: 'en_transito' }), JSON.stringify([CP(9)]),
  ])).rows[0].result;

  assert.equal(updated.destination, 'Potosí');
  assert.equal(updated.status, 'en_transito');
  assert.equal(updated.origin, 'La Paz'); // lo que no se envía no cambia
  const cps = (await db.query('SELECT name FROM route_checkpoints WHERE route_id = $1', [created.id])).rows;
  assert.deepEqual(cps.map((c) => c.name), ['Punto 9']);
});

test('update_route_with_checkpoints: NULL no toca los checkpoints y [] los elimina', async () => {
  const created = (await call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
    JSON.stringify({ origin: 'A', destination: 'B' }), JSON.stringify([CP(1), CP(2)]),
  ])).rows[0].result;

  await call('update_route_with_checkpoints($1::uuid, $2::jsonb, NULL)', [created.id, JSON.stringify({ origin: 'A2' })]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM route_checkpoints WHERE route_id = $1', [created.id])).rows[0].n, 2);

  await call('update_route_with_checkpoints($1::uuid, $2::jsonb, $3::jsonb)', [created.id, JSON.stringify({}), '[]']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM route_checkpoints WHERE route_id = $1', [created.id])).rows[0].n, 0);
});

test('update_route_with_checkpoints: ruta inexistente falla y no cambia nada', async () => {
  await assert.rejects(
    call('update_route_with_checkpoints($1::uuid, $2::jsonb, $3::jsonb)', ['11111111-1111-1111-1111-111111111111', JSON.stringify({ origin: 'X' }), JSON.stringify([CP(1)])]),
    /Ruta no encontrada/
  );
});

test('update_route_with_checkpoints: reemplazar checkpoints elimina también sus visitas', async () => {
  const created = (await call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
    JSON.stringify({ origin: 'A', destination: 'B' }), JSON.stringify([CP(1)]),
  ])).rows[0].result;
  const cpId = (await db.query('SELECT id FROM route_checkpoints WHERE route_id = $1', [created.id])).rows[0].id;
  await db.query('INSERT INTO checkpoint_visits (checkpoint_id) VALUES ($1)', [cpId]);

  await call('update_route_with_checkpoints($1::uuid, $2::jsonb, $3::jsonb)', [created.id, JSON.stringify({}), JSON.stringify([CP(2)])]);
  assert.equal(await count('checkpoint_visits'), 0);
});

test('delete_route_cascade: libera los paquetes y borra viajes, checkpoints y visitas', async () => {
  const created = (await call('create_route_with_checkpoints($1::jsonb, $2::jsonb)', [
    JSON.stringify({ origin: 'A', destination: 'B' }), JSON.stringify([CP(1)]),
  ])).rows[0].result;
  const routeId = created.id;
  const cpId = (await db.query('SELECT id FROM route_checkpoints WHERE route_id = $1', [routeId])).rows[0].id;
  const tripId = (await db.query('INSERT INTO driver_trips (route_id) VALUES ($1) RETURNING id', [routeId])).rows[0].id;
  const pkgId = (await db.query("INSERT INTO packages (route_id, status) VALUES ($1, 'en_transito') RETURNING id", [routeId])).rows[0].id;
  const logId = (await db.query("INSERT INTO tracking_logs (trip_id, status) VALUES ($1, 'x') RETURNING id", [tripId])).rows[0].id;
  await db.query('INSERT INTO checkpoint_visits (checkpoint_id, trip_id) VALUES ($1, $2)', [cpId, tripId]);

  assert.equal((await call('delete_route_cascade($1::uuid)', [routeId])).rows[0].result, true);

  assert.equal((await db.query('SELECT count(*)::int AS n FROM transport_routes WHERE id = $1', [routeId])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM driver_trips WHERE id = $1', [tripId])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM route_checkpoints WHERE id = $1', [cpId])).rows[0].n, 0);
  assert.equal(await count('checkpoint_visits'), 0);

  const pkg = (await db.query('SELECT route_id, status FROM packages WHERE id = $1', [pkgId])).rows[0];
  assert.equal(pkg.route_id, null);
  assert.equal(pkg.status, 'pendiente'); // el paquete no se pierde: vuelve a pendiente
  const log = (await db.query('SELECT trip_id FROM tracking_logs WHERE id = $1', [logId])).rows[0];
  assert.equal(log.trip_id, null); // el historial de tracking se conserva
});

test('delete_route_cascade: ruta inexistente falla', async () => {
  await assert.rejects(call('delete_route_cascade($1::uuid)', ['22222222-2222-2222-2222-222222222222']), /Ruta no encontrada/);
});

test('permisos: anon y authenticated no pueden ejecutar las funciones; service_role sí', async () => {
  const q = 'create_route_with_checkpoints($1::jsonb)';
  const body = JSON.stringify({ origin: 'perm', destination: 'x' });

  await db.exec('SET ROLE anon');
  await assert.rejects(call(q, [body]), /permission denied/i);
  await db.exec('RESET ROLE');

  await db.exec('SET ROLE authenticated');
  await assert.rejects(call('delete_route_cascade($1::uuid)', ['33333333-3333-3333-3333-333333333333']), /permission denied/i);
  await db.exec('RESET ROLE');

  // service_role necesita acceso a las tablas para ejecutar la función (en Supabase ya lo tiene)
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role');
  await db.exec('SET ROLE service_role');
  await assert.doesNotReject(call(q, [body]));
  await db.exec('RESET ROLE');
});

test('migración 018: agrega las columnas que faltan sin perder datos y es idempotente', async () => {
  const other = new PGlite();
  try {
    await other.exec("CREATE TABLE vehicles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), model TEXT); INSERT INTO vehicles (model) VALUES ('FH16');");
    await other.exec(sql('018_ensure_vehicles_columns.sql'));
    await other.exec(sql('018_ensure_vehicles_columns.sql')); // segunda ejecución: sin errores

    const cols = (await other.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles'")).rows.map((r) => r.column_name);
    for (const c of ['plate', 'brand', 'model', 'type', 'capacity_kg', 'status']) assert.ok(cols.includes(c), `falta la columna ${c}`);
    const row = (await other.query('SELECT model, status FROM vehicles')).rows[0];
    assert.equal(row.model, 'FH16');
  } finally {
    await other.close();
  }
});

test('migración 018: también crea la tabla si no existe', async () => {
  const other = new PGlite();
  try {
    await other.exec(sql('018_ensure_vehicles_columns.sql'));
    await other.exec("INSERT INTO vehicles (plate, model, type, capacity_kg) VALUES ('ABC-123', 'FH16', 'camion', 20000)");
    assert.equal((await other.query('SELECT status FROM vehicles')).rows[0].status, 'disponible');
  } finally {
    await other.close();
  }
});
