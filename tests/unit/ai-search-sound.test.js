import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTools } from '../../src/modules/ai-agent/ai-agent.tools.js';
import { distance, similarNames, soundKey, soundMatches } from '../../src/modules/ai-agent/ai-agent.sound.js';

const PKGS = [
  { tracking_code: 'TRK-1', status: 'pendiente', origen: 'La Paz', destino: 'Oruro', recipient_name: 'Rosa Quispe', sender_name: 'Tienda Sol', sender_id: 'c1', recipient_phone: '71234567', created_at: '2026-11-03T00:00:00Z' },
  { tracking_code: 'TRK-2', status: 'pendiente', origen: 'La Paz', destino: 'Oruro', recipient_name: 'Pedro Mamani', sender_name: 'Otra Tienda', sender_id: 'c2', created_at: '2026-11-02T00:00:00Z' },
  { tracking_code: 'TRK-3', status: 'pendiente', origen: 'La Paz', destino: 'Oruro', recipient_name: 'Rosa Kispe', sender_name: 'Tienda Sol', sender_id: 'c1', created_at: '2026-11-01T00:00:00Z' },
];

/** Base simulada que SÍ aplica los filtros eq y el or(ilike) de la búsqueda por nombre. */
const fakeDb = (rows, { fail = false } = {}) => ({
  from: () => {
    const q = { or: null, eq: [] };
    const run = () => {
      if (fail && !q.or) return { data: null, error: new Error('relation "packages" does not exist') }; // falla solo la consulta de contactos
      let r = rows.filter((row) => q.eq.every(([c, v]) => row[c] === v));
      if (q.or) {
        const term = q.or.match(/recipient_name\.ilike\.%(.*?)%,/)[1].toLowerCase();
        r = r.filter((row) => [row.recipient_name, row.sender_name].some((n) => String(n ?? '').toLowerCase().includes(term)));
      }
      return { data: r, error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b,
      or: (e) => { q.or = e; return b; },
      eq: (c, v) => { q.eq.push([c, v]); return b; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  },
});
const find = (user, db) => buildTools(user, db).find((t) => t.name === 'find_packages_by_person');
const ADMIN = { id: 'a1', role: 'admin' };

// ============================================================ el comparador
test('soundKey: letras que suenan igual dan la misma clave', () => {
  assert.equal(soundKey('Quispe'), soundKey('Kispe'));
  assert.equal(soundKey('Vargas'), soundKey('Bargas'));
  assert.equal(soundKey('Hernán'), soundKey('Ernan'));
  assert.equal(soundKey('Llanos'), soundKey('Yanos'));
  assert.notEqual(soundKey('Choque'), soundKey('Soque'));
});

test('soundMatches: prudente con lo corto y con lo distinto', () => {
  assert.equal(soundMatches('kispe', 'Rosa Quispe'), true);
  assert.equal(soundMatches('rosa kispe', 'Rosa Quispe'), true);
  assert.equal(soundMatches('rosa kispe', 'Rosa Flores'), false);
  assert.equal(soundMatches('ana', 'Ana Pérez'), false); // menos de 4 letras
  assert.equal(soundMatches('', 'Ana Pérez'), false);
  assert.equal(soundMatches(undefined, 'Ana Pérez'), false);
  assert.equal(distance('rosa', 'rosi'), 1);
});

test('similarNames: sin repetidos (aunque cambien tildes o mayúsculas) y con tope', () => {
  const names = ['Rosa Quispe', 'rosa quispe', 'ROSA QUISPÉ', 'Rosa Kispe', 'Pedro Mamani'];
  assert.deepEqual(similarNames('kispe', names), ['Rosa Quispe', 'Rosa Kispe']);
  assert.deepEqual(similarNames('kispe', names, 1), ['Rosa Quispe']);
  assert.deepEqual(similarNames('kispe', null), []);
});

// ============================================================ la herramienta
test('lo escrito bien se busca como siempre: sin segunda pasada y sin nota', async () => {
  const out = await find(ADMIN, fakeDb(PKGS)).invoke({ name: 'Mamani' });
  assert.match(out, /TRK-2/);
  assert.doesNotMatch(out, /suena parecido/);
});

test('un nombre mal escrito con UN solo candidato parecido: se busca con el nombre conocido y se avisa', async () => {
  const db = fakeDb(PKGS.filter((p) => p.tracking_code !== 'TRK-3'));
  const out = JSON.parse(await find(ADMIN, db).invoke({ name: 'Mamany' }));
  assert.equal(out.matches[0].tracking_code, 'TRK-2');
  assert.match(out.note, /No había nadie llamado «Mamany»/);
  assert.match(out.note, /Pedro Mamani/);
  assert.match(out.note, /verifique|verifica/i);
});

test('con varios nombres parecidos NO elige uno: pregunta cuál', async () => {
  const out = await find(ADMIN, fakeDb(PKGS)).invoke({ name: 'Quizpe' }); // suena «kispe»: no está escrito así en ningún paquete
  assert.match(out, /¿Se refiere a Rosa Quispe o a Rosa Kispe\?/);
  assert.doesNotMatch(out, /TRK-/, 'preguntar no devuelve datos de ningún paquete');
});

test('sin ningún nombre parecido responde lo de siempre', async () => {
  const out = await find(ADMIN, fakeDb(PKGS)).invoke({ name: 'Zzzzzz Qqqqqq' });
  assert.equal(out, 'No se encontró ningún paquete asociado a ese nombre.');
});

test('PRIVACIDAD: un cliente solo ve sugerencias de SUS paquetes, nunca nombres de otros clientes', async () => {
  const c1 = { id: 'c1', role: 'client' };
  const out = await find(c1, fakeDb(PKGS)).invoke({ name: 'Mamany' }); // «Mamani» es de un paquete de c2
  assert.equal(out, 'No se encontró ningún paquete asociado a ese nombre.');
  assert.doesNotMatch(out, /Mamani|TRK-2/);
  const own = await find(c1, fakeDb(PKGS)).invoke({ name: 'Quizpe' }); // sus propios «Quispe» y «Kispe»
  assert.match(own, /Rosa Quispe o a Rosa Kispe/);
  assert.doesNotMatch(own, /Otra Tienda|Pedro/);
});

test('un conductor sigue sin poder buscar por nombre (y no se consultan contactos)', async () => {
  let queried = false;
  const out = await find({ id: 'd1', role: 'driver' }, { from: () => { queried = true; throw new Error('no debe consultarse'); } }).invoke({ name: 'Kispe' });
  assert.match(out, /No tienes permiso/);
  assert.equal(queried, false);
});

test('si la sugerencia falla (error de la base), se responde como siempre y no se filtran detalles', async () => {
  const out = await find(ADMIN, fakeDb(PKGS, { fail: true })).invoke({ name: 'Quizpe' });
  assert.equal(out, 'No se encontró ningún paquete asociado a ese nombre.');
  assert.doesNotMatch(out, /relation|packages/);
});

test('un nombre con intento de inyección no altera la búsqueda de la sugerencia', async () => {
  const out = await find(ADMIN, fakeDb(PKGS)).invoke({ name: "kispe', or.(role.eq.admin)%" });
  assert.doesNotMatch(out, /role|admin/);
});
