import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _resetProposals } from '../../src/modules/ai-agent/ai-actions.service.js';
import { prepareEventProposal } from '../../src/modules/ai-agent/ai-agent.actions.js';
import * as controller from '../../src/modules/ai-agent/ai-agent.controller.js';

const ADMIN = { id: 'admin-1', role: 'admin' };
const OPERATOR = { id: 'op-1', role: 'logistics_operator' };
const CLIENT = { id: 'c-1', role: 'client' };
const DRIVER = { id: 'd-1', role: 'driver' };

/** Base simulada: por tabla, el resultado fijo; registra cualquier escritura para comprobar que proponer no escribe. */
const makeDb = (tables) => {
  const ops = [];
  return {
    ops,
    from: (table) => {
      const result = () => tables[table] ?? { data: [], error: null };
      const b = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        insert: () => { ops.push(['insert', table]); return b; },
        update: () => { ops.push(['update', table]); return b; },
        delete: () => { ops.push(['delete', table]); return b; },
        maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error ?? null }; },
        then: (res, rej) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
};
const PKG = { id: 'p1', tracking_code: 'TRK-1', status: 'en_transito', origen: 'La Paz', destino: 'Oruro', route_id: 'r1' };
const goodDb = () => makeDb({ packages: { data: [PKG] }, tracking_logs: { data: [{ lat: -17.6, lng: -67.2 }] } });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };

test.beforeEach(() => _resetProposals());

test('prepareEventProposal: devuelve la propuesta (con sus datos para que Logi la haga) y NO escribe en la base', async () => {
  const db = goodDb();
  const out = JSON.parse(await prepareEventProposal(ADMIN, db, { codes: ['TRK-1'], status: 'en_agencia', note: 'Llegó a la agencia' }));
  assert.equal(out.kind, 'action_proposal');
  assert.equal(out.action.type, 'register_tracking_event');
  assert.ok(out.action.lines.includes('Estado nuevo: En agencia'));
  assert.equal(out.action.ui.fill.form, 'event');
  assert.equal(out.action.ui.fill.values.status, 'en_agencia');
  assert.equal(out.action.ui.fill.values.items[0].tracking_code, 'TRK-1');
  assert.equal(db.ops.length, 0, 'proponer no debe modificar nada');
});

test('SEGURIDAD: solo el personal; un cliente o un conductor no pueden preparar eventos', async () => {
  for (const user of [CLIENT, DRIVER]) assert.match(await prepareEventProposal(user, goodDb(), { codes: ['TRK-1'], status: 'en_agencia' }), /no tienes permiso/i);
  assert.equal(JSON.parse(await prepareEventProposal(OPERATOR, goodDb(), { codes: ['TRK-1'], status: 'en_agencia' })).kind, 'action_proposal');
});

test('rechaza con un motivo: paquete inexistente, ya entregado o estado no permitido', async () => {
  assert.match(await prepareEventProposal(ADMIN, makeDb({ packages: { data: [] } }), { codes: ['TRK-9'], status: 'en_agencia' }), /No se encontró ningún paquete/);
  const done = makeDb({ packages: { data: [{ ...PKG, status: 'entregado' }] } });
  assert.match(await prepareEventProposal(ADMIN, done, { codes: ['TRK-1'], status: 'en_agencia' }), /ya está entregado/i);
  assert.match(await prepareEventProposal(ADMIN, goodDb(), { codes: ['TRK-1'], status: 'volando' }), /Estado no permitido/);
});

test('POST /suggestions/event: 200 con la propuesta, 403 sin permiso, 409 si no se puede, 400 si el cuerpo es inválido', async () => {
  controller._useDb(goodDb());
  const ok = res();
  await controller.handlePrepareEvent({ user: ADMIN, body: { codes: ['TRK-1'], status: 'siniestro', note: 'Daño en el embalaje' } }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.kind, 'action_proposal');
  assert.equal(ok.body.data.action.type, 'register_tracking_event');

  const denied = res();
  await controller.handlePrepareEvent({ user: CLIENT, body: { codes: ['TRK-1'], status: 'en_agencia' } }, denied);
  assert.equal(denied.code, 403);

  controller._useDb(makeDb({ packages: { data: [] } }));
  const nothing = res();
  await controller.handlePrepareEvent({ user: ADMIN, body: { codes: ['TRK-404'], status: 'en_agencia' } }, nothing);
  assert.equal(nothing.code, 409);
  assert.match(nothing.body.message, /No se encontró ningún paquete/);

  controller._useDb(goodDb());
  const bodies = [
    {}, { codes: [], status: 'en_agencia' }, { codes: ['TRK-1'] }, { codes: ['TRK-1'], status: 'entregado' }, // entregar no es un evento
    { codes: ['TRK-1'], status: 'en_agencia', note: 'x'.repeat(501) },
    { codes: Array.from({ length: 11 }, (_, i) => `TRK-${i}`), status: 'en_agencia' }, { codes: ['ab'], status: 'en_agencia' },
  ];
  for (const body of bodies) {
    const bad = res();
    await controller.handlePrepareEvent({ user: ADMIN, body }, bad);
    assert.equal(bad.code, 400, JSON.stringify(body).slice(0, 80));
  }
  controller._useDb();
});
