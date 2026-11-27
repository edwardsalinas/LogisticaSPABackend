import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAuth, requireRole, resolveRole, _setTokenVerifier } from '../../src/modules/iam/iam.middleware.js';
import { isTransientAuthError, refreshWith, signInWith, verifyToken } from '../../src/modules/iam/iam.service.js';

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

const reqCookie = { headers: { cookie: 'sb_access=token', 'x-requested-with': 'XMLHttpRequest' }, method: 'POST' };
const authApiError = Object.assign(new Error('invalid JWT: secreto interno'), { name: 'AuthApiError', status: 401 });
const retryable = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 });

test('requireAuth: un token inválido es 401 y no filtra detalles internos', async () => {
  _setTokenVerifier(async () => { throw authApiError; });
  try {
    const r = await run(requireAuth, reqCookie);
    assert.equal(r.status, 401);
    assert.deepEqual(Object.keys(r.body), ['message']);
    assert.equal(r.body.message, 'Invalid or expired token');
    assert.equal(r.nextCalled, false);
  } finally { _setTokenVerifier(null); }
});

test('requireAuth: un corte del servicio de autenticación es 503 con Retry-After, NO un 401 (no cierra la sesión)', async () => {
  const headers = {};
  let status; let body;
  const res = { set(k, v) { headers[k] = v; return this; }, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  for (const err of [retryable, Object.assign(new Error('x'), { status: 503 }), Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })]) {
    _setTokenVerifier(async () => { throw err; });
    let next = false;
    await requireAuth(reqCookie, res, () => { next = true; });
    assert.equal(status, 503, err.name);
    assert.equal(body.message, 'Authentication service temporarily unavailable');
    assert.equal(headers['Retry-After'], '2');
    assert.equal(next, false);
  }
  _setTokenVerifier(null);
});

test('requireAuth: un token válido pasa y deja al usuario con su rol', async () => {
  _setTokenVerifier(async () => ({ id: 'u1', app_metadata: { role: 'admin' } }));
  try {
    const req = { ...reqCookie, method: 'GET' };
    const r = await run(requireAuth, req);
    assert.equal(r.nextCalled, true);
    assert.equal(req.user.role, 'admin');
  } finally { _setTokenVerifier(null); }
});

test('isTransientAuthError: distingue fallos del servicio de sesiones inválidas', () => {
  assert.equal(isTransientAuthError(retryable), true);
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { status: 500 })), true);
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isTransientAuthError(Object.assign(new TypeError('fetch failed'))), true);
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } })), true);
  assert.equal(isTransientAuthError(authApiError), false);                                  // 401: token inválido
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { status: 403 })), false);
  assert.equal(isTransientAuthError(Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 })), false);
  assert.equal(isTransientAuthError(null), false);
});

test('verifyToken: reintenta UNA vez ante un corte y devuelve el usuario; un token inválido no se reintenta', async () => {
  let calls = 0;
  const flaky = { auth: { getUser: async () => { calls += 1; return calls === 1 ? { data: {}, error: retryable } : { data: { user: { id: 'u1' } }, error: null }; } } };
  assert.deepEqual(await verifyToken('t', { client: flaky, waitMs: 1 }), { id: 'u1' });
  assert.equal(calls, 2);
  let bad = 0;
  const invalid = { auth: { getUser: async () => { bad += 1; return { data: {}, error: authApiError }; } } };
  await assert.rejects(verifyToken('t', { client: invalid, waitMs: 1 }), (e) => e === authApiError);
  assert.equal(bad, 1); // un 401 no se reintenta
  let down = 0;
  const caido = { auth: { getUser: async () => { down += 1; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } } };
  await assert.rejects(verifyToken('t', { client: caido, waitMs: 1 }), /fetch failed/);
  assert.equal(down, 2); // un reintento y se rinde
});

test('renovar la sesión: un corte de red NO la cierra; un refresh token vencido sí', async () => {
  const net = { auth: { refreshSession: async () => ({ data: {}, error: retryable }) } };
  const thrown = { auth: { refreshSession: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } } };
  const vencido = { auth: { refreshSession: async () => ({ data: {}, error: Object.assign(new Error('Invalid Refresh Token: Already Used'), { name: 'AuthApiError', status: 400 }) }) } };
  const sinSesion = { auth: { refreshSession: async () => ({ data: { session: null }, error: null }) } };
  const bien = { auth: { refreshSession: async () => ({ data: { session: { access_token: 'a' }, user: { id: 'u' } }, error: null }) } };
  assert.equal((await refreshWith(net, 'r')).transient, true);
  assert.equal((await refreshWith(thrown, 'r')).transient, true);
  const v = await refreshWith(vencido, 'r');
  assert.equal(v.transient, false);
  assert.ok(v.error);
  assert.equal((await refreshWith(sinSesion, 'r')).error.message, 'Sesión expirada');
  assert.ok((await refreshWith(bien, 'r')).data.session);
});

test('iniciar sesión: credenciales inválidas son error; un corte del servicio es transitorio', async () => {
  const malas = { auth: { signInWithPassword: async () => ({ data: {}, error: Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 }) }) } };
  const caido = { auth: { signInWithPassword: async () => ({ data: {}, error: retryable }) } };
  const bien = { auth: { signInWithPassword: async () => ({ data: { session: { access_token: 'a' } }, error: null }) } };
  const m = await signInWith(malas, { email: 'a', password: 'b' });
  assert.equal(m.transient, false);
  assert.match(m.error.message, /Invalid login credentials/);
  assert.equal((await signInWith(caido, {})).transient, true);
  assert.ok((await signInWith(bien, {})).data.session);
});
