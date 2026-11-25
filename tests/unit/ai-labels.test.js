import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, timeLabel, tripLabel } from '../../src/modules/ai-agent/ai-agent.labels.js';
import { systemPrompt } from '../../src/modules/ai-agent/ai-agent.service.js';

// 24 nov 2026, 10:00 en Bolivia (14:00 UTC)
const NOW = Date.parse('2026-11-24T14:00:00Z');
const at = (iso) => ({ origin: 'Santa Cruz', destination: 'Cochabamba', departure_time: iso });

test('el viaje se nombra por origen, destino, día y hora de Bolivia, sin identificadores', () => {
  assert.equal(tripLabel(at('2026-11-24T23:00:00Z'), NOW), 'el viaje de Santa Cruz a Cochabamba de hoy a las 19:00');
  assert.equal(tripLabel(at('2026-11-25T12:30:00Z'), NOW), 'el viaje de Santa Cruz a Cochabamba de mañana a las 08:30');
});

test('un día más lejano lleva el día de la semana y la fecha', () => {
  const label = tripLabel(at('2026-11-27T21:00:00Z'), NOW);
  assert.match(label, /^el viaje de Santa Cruz a Cochabamba del viernes,? 27 de noviembre a las 17:00$/);
});

test('sin datos de ruta o sin hora, no inventa ni falla', () => {
  assert.equal(tripLabel({}, NOW), 'el viaje');
  assert.equal(tripLabel({ origin: 'A', destination: 'B' }, NOW), 'el viaje de A a B');
  assert.equal(tripLabel({ origin: 'A', destination: 'B', departure_time: 'basura' }, NOW), 'el viaje de A a B');
});

test('dayLabel y timeLabel usan la hora de Bolivia (no la del servidor)', () => {
  assert.equal(timeLabel('2026-11-24T23:00:00Z'), '19:00');
  assert.equal(dayLabel('2026-11-24T03:00:00Z', NOW), 'ayer'); // 23:00 del día 23 en Bolivia, aunque sea el 24 en UTC
});

test('las instrucciones prohíben mostrar identificadores y prometer cosas que no se pueden hacer', () => {
  const prompt = systemPrompt({ role: 'client' }, { toolNames: ['find_available_trips'] });
  assert.match(prompt, /Nunca muestres identificadores internos/);
  assert.match(prompt, /label/);
  assert.match(prompt, /no prometas avisar, reenviar información ni registrar/);
  assert.match(prompt, /tú no puedes avisarles ni pasarles información/);
});
