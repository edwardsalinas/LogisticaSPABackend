import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCaptcha } from '../../src/shared/middlewares/captcha.js';

const run = async (req) => {
  let status = 200;
  let body;
  let nextCalled = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await requireCaptcha(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled };
};

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});

test('sin TURNSTILE_SECRET_KEY el captcha queda deshabilitado', async () => {
  const r = await run({ headers: {}, body: {} });
  assert.equal(r.nextCalled, true);
});

test('con secreto y sin token responde 400 CAPTCHA_REQUIRED', async () => {
  process.env.TURNSTILE_SECRET_KEY = 's';
  const r = await run({ headers: {}, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'CAPTCHA_REQUIRED');
});

test('token válido (siteverify success) deja pasar y envía el secreto y el token', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'mi-secreto';
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, body: init.body.toString() };
    return { json: async () => ({ success: true }) };
  };
  const r = await run({ headers: { 'x-captcha-token': 'tok123' }, body: {}, ip: '1.2.3.4' });
  assert.equal(r.nextCalled, true);
  assert.match(sent.url, /turnstile\/v0\/siteverify/);
  assert.match(sent.body, /secret=mi-secreto/);
  assert.match(sent.body, /response=tok123/);
  assert.match(sent.body, /remoteip=1\.2\.3\.4/);
});

test('token inválido responde 403 CAPTCHA_INVALID', async () => {
  process.env.TURNSTILE_SECRET_KEY = 's';
  globalThis.fetch = async () => ({ json: async () => ({ success: false }) });
  const r = await run({ headers: { 'x-captcha-token': 'malo' }, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'CAPTCHA_INVALID');
});

test('si no se puede verificar, rechaza (fail closed) con 503', async () => {
  process.env.TURNSTILE_SECRET_KEY = 's';
  globalThis.fetch = async () => { throw new Error('sin red'); };
  const r = await run({ headers: { 'x-captcha-token': 'x' }, body: {} });
  assert.equal(r.status, 503);
  assert.equal(r.nextCalled, false);
});
