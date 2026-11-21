import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAuth, requireRole, resolveRole } from '../../src/modules/iam/iam.middleware.js';

const run = async (mw, req) => {
  let status = 200;
  let body;
  let nextCalled = false;
  const res = {
    status(code) { status = code; return this; },
    json(b) { body = b; return this; },
  };
  await mw(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled };
};

test('resolveRole: app_metadata prevalece sobre user_metadata', () => {
  const user = { app_metadata: { role: 'client' }, user_metadata: { role: 'admin' } };
  assert.equal(resolveRole(user, true), 'client');
  assert.equal(resolveRole(user, false), 'client');
});

test('resolveRole: user_metadata solo se acepta como respaldo de transición', () => {
  const user = { user_metadata: { role: 'admin' } };
  assert.equal(resolveRole(user, true), 'admin');
  assert.equal(resolveRole(user, false), 'client'); // con el respaldo apagado no hay escalada de privilegios
});

test('resolveRole: sin rol definido es client', () => {
  assert.equal(resolveRole({}, true), 'client');
  assert.equal(resolveRole(undefined, false), 'client');
});

test('requireRole usa el rol resuelto, no user_metadata', async () => {
  const mw = requireRole(['admin']);
  const forbidden = await run(mw, { user: { role: 'client', user_metadata: { role: 'admin' } } });
  assert.equal(forbidden.status, 403);
  const allowed = await run(mw, { user: { role: 'admin' } });
  assert.equal(allowed.nextCalled, true);
  const anon = await run(mw, {});
  assert.equal(anon.status, 401);
});

test('requireAuth: sin token responde 401', async () => {
  const r = await run(requireAuth, { headers: {}, method: 'GET' });
  assert.equal(r.status, 401);
});

test('requireAuth: cookie sin header anti-CSRF en POST responde 403', async () => {
  const r = await run(requireAuth, { headers: { cookie: 'sb_access=token-falso' }, method: 'POST' });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /CSRF/);
});

test('requireAuth: el error de autenticación no filtra detalles internos', async () => {
  // Con el header CSRF la petición avanza hasta verificar el token (Supabase inalcanzable en pruebas)
  const r = await run(requireAuth, {
    headers: { cookie: 'sb_access=token-falso', 'x-requested-with': 'XMLHttpRequest' },
    method: 'POST',
  });
  assert.equal(r.status, 401);
  assert.deepEqual(Object.keys(r.body), ['message']);
});
