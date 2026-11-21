import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, formatChange } from '../../src/modules/statistics/statistics.service.js';

test('haversineKm: La Paz - Cochabamba ronda los 215 km en línea recta', () => {
  const d = haversineKm(-16.5, -68.15, -17.39, -66.157);
  assert.ok(d > 200 && d < 235, `distancia inesperada: ${d}`);
});

test('haversineKm: mismo punto es 0', () => {
  assert.equal(haversineKm(-17, -66, -17, -66), 0);
});

test('formatChange: variación porcentual con signo', () => {
  assert.equal(formatChange(15, 10), '+50%');
  assert.equal(formatChange(5, 10), '-50%');
  assert.equal(formatChange(10, 10), '0%');
});

test('formatChange: sin base de comparación', () => {
  assert.equal(formatChange(3, 0), '+100%');
  assert.equal(formatChange(0, 0), '0%');
});
