import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimestamp, assertPackageAccess } from '../../src/modules/tracking/tracking.controller.js';
import { maskName } from '../../src/modules/tracking/tracking.service.js';
import { generateTrackingCode } from '../../src/modules/logistics/logistics.service.js';

test('resolveTimestamp: sin valor usa la hora actual', () => {
  const t = new Date(resolveTimestamp()).getTime();
  assert.ok(Math.abs(Date.now() - t) < 2000);
});

test('resolveTimestamp: conserva la hora real de un punto offline (pasado)', () => {
  assert.equal(resolveTimestamp('2026-01-01T10:00:00.000Z'), '2026-01-01T10:00:00.000Z');
});

test('resolveTimestamp: limita fechas futuras a "ahora"', () => {
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  assert.ok(new Date(resolveTimestamp(future)).getTime() <= Date.now());
});

test('resolveTimestamp: un valor inválido lanza error 400', () => {
  assert.throws(() => resolveTimestamp('no-es-fecha'), (e) => e.status === 400);
});

test('maskName enmascara nombres para el rastreo público', () => {
  assert.equal(maskName('Juan Pérez'), 'J*** P****');
  assert.equal(maskName('  María   López '), 'M**** L****');
  assert.equal(maskName('A'), 'A');
  assert.equal(maskName(null), null);
  assert.equal(maskName(''), '');
});

test('generateTrackingCode: formato y unicidad', () => {
  const codes = new Set(Array.from({ length: 500 }, generateTrackingCode));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, /^TRK-\d{13}-[0-9A-F]{8}$/);
});

const fakeDb = (row, error = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
});

test('assertPackageAccess: el cliente accede a su propio paquete', async () => {
  await assert.doesNotReject(assertPackageAccess({ id: 'u1', role: 'client' }, 'p1', fakeDb({ sender_id: 'u1' })));
});

test('assertPackageAccess: el cliente NO accede al paquete de otro (403)', async () => {
  await assert.rejects(assertPackageAccess({ id: 'u1', role: 'client' }, 'p1', fakeDb({ sender_id: 'u2' })), (e) => e.status === 403);
});

test('assertPackageAccess: paquete inexistente (404) y roles operativos sin restricción', async () => {
  await assert.rejects(assertPackageAccess({ id: 'u1', role: 'client' }, 'p1', fakeDb(null)), (e) => e.status === 404);
  await assert.doesNotReject(assertPackageAccess({ id: 'a', role: 'admin' }, 'p1', fakeDb({ sender_id: 'otro' })));
  await assert.doesNotReject(assertPackageAccess({ id: 'd', role: 'driver' }, 'p1', fakeDb({ sender_id: 'otro' })));
});
