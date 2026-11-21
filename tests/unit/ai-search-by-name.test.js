import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTools, sanitizeName } from '../../src/modules/ai-agent/ai-agent.tools.js';

// Base simulada que registra los filtros aplicados a la consulta
const recordingDb = (rows = []) => {
  const calls = { filters: [], or: null, table: null };
  const builder = {
    select: () => builder,
    or: (expr) => { calls.or = expr; return builder; },
    eq: (col, val) => { calls.filters.push([col, val]); return builder; },
    order: () => builder,
    limit: () => builder,
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return { db: { from: (table) => { calls.table = table; return builder; } }, calls };
};

const find = (user, db) => buildTools(user, db).find((t) => t.name === 'find_packages_by_person');
const MATCH = [{ tracking_code: 'TRK-1', status: 'en_transito', origen: 'La Paz', destino: 'Oruro', recipient_name: 'Juan Pérez', sender_name: 'Ana', created_at: 't' }];

test('HU01: el agente tiene la herramienta de búsqueda por nombre', () => {
  assert.ok(buildTools({ id: 'a', role: 'admin' }, recordingDb().db).some((t) => t.name === 'find_packages_by_person'));
});

test('HU01: un cliente solo busca entre SUS paquetes (filtro sender_id en la consulta)', async () => {
  const { db, calls } = recordingDb(MATCH);
  const out = await find({ id: 'cliente-1', role: 'client' }, db).invoke({ name: 'Juan Pérez' });
  assert.deepEqual(calls.filters, [['sender_id', 'cliente-1']]);
  assert.match(out, /TRK-1/);
});

test('HU01: admin y operador buscan en todos los paquetes (sin filtro de remitente)', async () => {
  for (const role of ['admin', 'logistics_operator']) {
    const { db, calls } = recordingDb(MATCH);
    await find({ id: 'x', role }, db).invoke({ name: 'Pérez' });
    assert.deepEqual(calls.filters, []);
  }
});

test('HU01: el conductor no puede buscar por nombre de personas', async () => {
  const { db, calls } = recordingDb(MATCH);
  const out = await find({ id: 'd1', role: 'driver' }, db).invoke({ name: 'Juan Pérez' });
  assert.match(out, /No tienes permiso/);
  assert.equal(calls.table, null); // ni siquiera consulta la base
});

test('HU01: el nombre se busca en destinatario y remitente', async () => {
  const { db, calls } = recordingDb(MATCH);
  await find({ id: 'a', role: 'admin' }, db).invoke({ name: 'Mamani' });
  assert.equal(calls.or, 'recipient_name.ilike.%Mamani%,sender_name.ilike.%Mamani%');
});

test('HU01: un nombre con caracteres de filtro no puede alterar la consulta (inyección en PostgREST)', async () => {
  const { db, calls } = recordingDb(MATCH);
  await find({ id: 'cliente-1', role: 'client' }, db).invoke({ name: 'x%),sender_id.neq.cliente-1,(y' });
  // Los signos quedan como espacios: el texto hostil es solo parte del patrón, no sintaxis del filtro
  assert.equal(calls.or, 'recipient_name.ilike.%x sender id neq cliente-1 y%,sender_name.ilike.%x sender id neq cliente-1 y%');
  assert.equal(calls.or.split(',').length, 2); // exactamente dos condiciones: destinatario y remitente
  assert.deepEqual(calls.filters, [['sender_id', 'cliente-1']]); // el filtro de propiedad sigue vigente
});

test('HU01: sanitizeName conserva tildes, ñ, guiones y apóstrofes y elimina comodines y signos', () => {
  assert.equal(sanitizeName('José Núñez-Peña'), 'José Núñez-Peña');
  assert.equal(sanitizeName("O'Brien"), "O'Brien");
  assert.equal(sanitizeName('100%_real,(x).y\\'), '100 real x y');
  assert.equal(sanitizeName(null), '');
});

test('HU01: un nombre demasiado corto se rechaza sin consultar la base', async () => {
  const { db, calls } = recordingDb(MATCH);
  const out = await find({ id: 'a', role: 'admin' }, db).invoke({ name: 'Ju' });
  assert.match(out, /al menos 3 letras/);
  assert.equal(calls.table, null);
});

test('HU01: sin coincidencias lo dice con claridad', async () => {
  const { db } = recordingDb([]);
  assert.match(await find({ id: 'a', role: 'admin' }, db).invoke({ name: 'Nadie Existe' }), /No se encontró/);
});
