import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, setAuthCookies, clearAuthCookies, ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/modules/iam/iam.cookies.js';

const fakeRes = () => {
  const calls = [];
  return {
    calls,
    cookie: (name, value, opts) => calls.push({ type: 'set', name, value, opts }),
    clearCookie: (name, opts) => calls.push({ type: 'clear', name, opts }),
  };
};

test('parseCookies lee varias cookies y decodifica valores', () => {
  const c = parseCookies('a=1; sb_access=abc%20def; b=x=y');
  assert.equal(c.a, '1');
  assert.equal(c.sb_access, 'abc def');
  assert.equal(c.b, 'x=y');
});

test('parseCookies tolera cabecera vacía o malformada', () => {
  assert.deepEqual(parseCookies(), {});
  assert.deepEqual(parseCookies('sinvalor; =x'), {});
  assert.equal(parseCookies('a=%E0%A4%A').a, '%E0%A4%A'); // decodeURIComponent inválido -> valor crudo
});

test('setAuthCookies emite cookies httpOnly con SameSite y duración', () => {
  const res = fakeRes();
  setAuthCookies(res, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  const access = res.calls.find((c) => c.name === ACCESS_COOKIE);
  const refresh = res.calls.find((c) => c.name === REFRESH_COOKIE);
  assert.equal(access.value, 'AT');
  assert.equal(access.opts.httpOnly, true);
  assert.equal(access.opts.sameSite, 'lax');
  assert.equal(access.opts.maxAge, 3600 * 1000);
  assert.equal(refresh.opts.httpOnly, true);
  assert.equal(refresh.opts.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test('SameSite=None fuerza el atributo Secure', () => {
  process.env.COOKIE_SAMESITE = 'none';
  process.env.COOKIE_SECURE = 'false';
  const res = fakeRes();
  setAuthCookies(res, { access_token: 'AT', expires_in: 60 });
  assert.equal(res.calls[0].opts.sameSite, 'none');
  assert.equal(res.calls[0].opts.secure, true);
  delete process.env.COOKIE_SAMESITE;
  delete process.env.COOKIE_SECURE;
});

test('clearAuthCookies borra ambas cookies', () => {
  const res = fakeRes();
  clearAuthCookies(res);
  assert.deepEqual(res.calls.map((c) => c.name).sort(), [ACCESS_COOKIE, REFRESH_COOKIE].sort());
  assert.ok(res.calls.every((c) => c.type === 'clear'));
});
