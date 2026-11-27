import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRetryGuard } from '../../src/modules/ai-agent/ai-agent.service.js';
import { _resetProposals, confirmProposal, createProposal } from '../../src/modules/ai-agent/ai-actions.service.js';

const err = (status, message = 'x') => Object.assign(new Error(message), { status });
const USER = { id: 'u1', role: 'admin' };

test.beforeEach(() => _resetProposals());

test('sin propuestas preparadas se puede reintentar con cualquier error', () => {
  const state = { proposed: false, ids: [], user: USER };
  const guard = makeRetryGuard(state);
  assert.equal(guard(err(429)), true);
  assert.equal(guard(err(500)), true);
  assert.equal(guard(new Error('raro')), true);
});

test('con una propuesta ya creada, un error que NO es de límite de uso no se reintenta y no se descarta nada', () => {
  const cancelled = [];
  const state = { proposed: true, ids: ['p1'], user: USER };
  const guard = makeRetryGuard(state, (id) => cancelled.push(id));
  assert.equal(guard(err(500, 'boom')), false);
  assert.equal(guard(err(400, 'bad request')), false);
  assert.deepEqual(cancelled, []);
  assert.equal(state.proposed, true);
});

test('con una propuesta ya creada, un límite de uso (429) SÍ permite reintentar, y antes descarta las propuestas del intento fallido', () => {
  const cancelled = [];
  const state = { proposed: true, ids: ['p1', 'p2'], user: USER };
  const guard = makeRetryGuard(state, (id, user) => cancelled.push([id, user.id]));
  assert.equal(guard(err(429, 'Rate limit reached on tokens per minute')), true);
  assert.deepEqual(cancelled, [['p1', 'u1'], ['p2', 'u1']]);
  assert.equal(state.proposed, false);   // el nuevo intento parte limpio
  assert.deepEqual(state.ids, []);
  // y si el nuevo intento también crea una propuesta y vuelve a toparse, se descarta esa
  state.proposed = true; state.ids = ['p3'];
  assert.equal(guard(err(429)), true);
  assert.deepEqual(cancelled.at(-1), ['p3', 'u1']);
});

test('las propuestas descartadas ya no se pueden confirmar (no quedan tarjetas fantasma ejecutables)', async () => {
  const mk = () => createProposal({ user: USER, type: 'create_package', params: { data: {} }, title: 't', lines: [] }).id;
  const [a, b] = [mk(), mk()];
  const state = { proposed: true, ids: [a], user: USER };
  assert.equal(makeRetryGuard(state)(err(429)), true); // usa cancelProposal de verdad
  await assert.rejects(confirmProposal(a, USER, { create_package: async () => ({ message: 'ok' }) }), /ya no se puede confirmar/);
  // la propuesta del intento bueno (b) sigue vigente y confirmable
  const res = await confirmProposal(b, USER, { create_package: async () => ({ message: 'hecho' }) });
  assert.equal(res.message, 'hecho');
});

test('un id que ya no está pendiente (se confirmó o venció) no rompe el reintento', async () => {
  const id = createProposal({ user: USER, type: 'create_package', params: { data: {} }, title: 't', lines: [] }).id;
  await confirmProposal(id, USER, { create_package: async () => ({ message: 'ok' }) });
  const state = { proposed: true, ids: [id, 'inexistente'], user: USER };
  assert.equal(makeRetryGuard(state)(err(429)), true);
});
