import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../../src/app.js';

let server;
let base;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

const json = (path, init = {}) =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });

test('GET /health responde ok', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('CORS: solo se aceptan los orígenes configurados y se permiten credenciales', async () => {
  const ok = await fetch(base + '/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  const bad = await fetch(base + '/health', { headers: { Origin: 'http://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('rutas protegidas exigen autenticación', async () => {
  for (const path of ['/api/iam/profile', '/api/logistics/packages', '/api/fleet/clients', '/api/statistics/dashboard']) {
    assert.equal((await fetch(base + path)).status, 401, path);
  }
});

test('CSRF: una sesión por cookie no puede modificar datos sin el header de protección', async () => {
  const res = await json('/api/logistics/packages', { method: 'POST', headers: { cookie: 'sb_access=x' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('los checkpoints no se pueden modificar sin sesión (401)', async () => {
  const res = await json('/api/logistics/routes/r1/checkpoints', { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
});

test('login: valida el cuerpo antes de consultar a Supabase', async () => {
  const res = await json('/api/iam/login', { method: 'POST', body: JSON.stringify({ email: 'no-es-email' }) });
  assert.equal(res.status, 400);
});

test('rastreo público: rate limiting por IP (429) y cabeceras RateLimit', async () => {
  const statuses = [];
  let last;
  for (let i = 0; i < 4; i += 1) {
    last = await fetch(base + '/api/tracking/public/TRK-1');
    statuses.push(last.status);
  }
  assert.ok(statuses.includes(429), `se esperaba un 429: ${statuses}`);
  assert.ok(last.headers.get('ratelimit') || last.headers.get('ratelimit-policy'));
});

test('login: rate limiting tras demasiados intentos fallidos (429)', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await json('/api/iam/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'x' }) });
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429), `se esperaba un 429: ${statuses}`);
});
