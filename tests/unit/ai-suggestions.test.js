import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planAssignments, sameCity, buildSuggestionTools } from '../../src/modules/ai-agent/ai-agent.suggestions.js';
import { prepareAssignProposal } from '../../src/modules/ai-agent/ai-agent.actions.js';
import { fastPlanFor, intentsOf, selectToolNames } from '../../src/modules/ai-agent/ai-agent.intents.js';
import { toolsForUser, extractAttachments } from '../../src/modules/ai-agent/ai-agent.tools.js';
import { _resetProposals } from '../../src/modules/ai-agent/ai-actions.service.js';
import * as controller from '../../src/modules/ai-agent/ai-agent.controller.js';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const h = (hours) => new Date(NOW + hours * 3600 * 1000).toISOString();
const pkg = (code, kg, over = {}) => ({ tracking_code: code, origen: 'Cochabamba', destino: 'La Paz', peso: kg, recipient_name: `dest ${code}`, created_at: h(-10), ...over });
const trip = (ref, free, over = {}) => ({ ref, origin: 'Cochabamba', destination: 'La Paz', departure_time: h(24), free_kg: free, vehicle: 'Volvo FH16', ...over });
const plan = (packages, trips) => planAssignments({ packages, trips, now: NOW });

const ADMIN = { id: 'a1', role: 'admin' };
const OPERATOR = { id: 'o1', role: 'logistics_operator' };
const CLIENT = { id: 'c1', role: 'client' };
const DRIVER = { id: 'd1', role: 'driver' };

// ============================================================ ciudades
test('las ciudades coinciden aunque cambien tildes, mayúsculas o haya texto de más', () => {
  assert.equal(sameCity('La Paz', 'la paz'), true);
  assert.equal(sameCity('Potosí', 'Potosi'), true);
  assert.equal(sameCity('La Paz, Bolivia', 'La Paz'), true);
  assert.equal(sameCity('Oruro', 'La Paz'), false);
  assert.equal(sameCity('', 'La Paz'), false);
  assert.equal(sameCity(null, null), false);
});

// ============================================================ planificador
test('asigna cada paquete a un viaje de su misma ruta', () => {
  const { groups, unassigned } = plan([pkg('TRK-1', 10), pkg('TRK-2', 5)], [trip('V1', 100)]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].packages.map((p) => p.tracking_code), ['TRK-1', 'TRK-2']);
  assert.equal(groups[0].total_kg, 15);
  assert.equal(groups[0].remaining_kg, 85);
  assert.deepEqual(unassigned, []);
});

test('no mezcla rutas: un paquete solo va a un viaje con su origen y destino', () => {
  const { groups, unassigned } = plan(
    [pkg('TRK-1', 10), pkg('TRK-2', 10, { origen: 'Oruro', destino: 'La Paz' })],
    [trip('V1', 100), trip('V2', 100, { origin: 'Oruro' })],
  );
  assert.deepEqual(groups.map((g) => [g.route_ref, g.packages.map((p) => p.tracking_code)]), [['V1', ['TRK-1']], ['V2', ['TRK-2']]]);
  assert.deepEqual(unassigned, []);
});

test('prefiere el viaje que sale antes y pasa al siguiente cuando se llena', () => {
  const { groups } = plan(
    [pkg('TRK-1', 60), pkg('TRK-2', 60), pkg('TRK-3', 30)],
    [trip('TARDE', 100, { departure_time: h(48) }), trip('TEMPRANO', 100, { departure_time: h(24) })],
  );
  const byRef = Object.fromEntries(groups.map((g) => [g.route_ref, g.packages.map((p) => p.tracking_code)]));
  assert.deepEqual(byRef.TEMPRANO, ['TRK-1', 'TRK-3']); // 60 + 30 caben en 100
  assert.deepEqual(byRef.TARDE, ['TRK-2']);              // el segundo de 60 ya no cabía en el primero
});

test('los paquetes más antiguos se atienden primero cuando falta espacio', () => {
  const { groups, unassigned } = plan(
    [pkg('NUEVO', 50, { created_at: h(-1) }), pkg('VIEJO', 50, { created_at: h(-100) })],
    [trip('V1', 60)],
  );
  assert.deepEqual(groups[0].packages.map((p) => p.tracking_code), ['VIEJO']);
  assert.equal(unassigned[0].tracking_code, 'NUEVO');
  assert.match(unassigned[0].reason, /no cabe.*10 kg libres.*pesa 50 kg/);
});

test('un paquete sin viaje de su ruta queda sin asignar y explica por qué', () => {
  const { groups, unassigned } = plan([pkg('TRK-1', 10, { destino: 'Santa Cruz' })], [trip('V1', 100)]);
  assert.deepEqual(groups, []);
  assert.match(unassigned[0].reason, /no hay un viaje planeado de Cochabamba a Santa Cruz/);
});

test('no sugiere viajes que ya salieron', () => {
  const { groups, unassigned } = plan([pkg('TRK-1', 10)], [trip('PASADO', 100, { departure_time: h(-2) })]);
  assert.deepEqual(groups, []);
  assert.equal(unassigned.length, 1);
});

test('un paquete sin peso no se asigna a ciegas', () => {
  const { groups, unassigned } = plan([pkg('TRK-1', null), pkg('TRK-2', 0), pkg('TRK-3', -4)], [trip('V1', 100)]);
  assert.deepEqual(groups, []);
  assert.ok(unassigned.every((u) => /peso/.test(u.reason)));
});

test('un viaje sin dato de capacidad se permite pero se marca', () => {
  const { groups } = plan([pkg('TRK-1', 500)], [trip('V1', null)]);
  assert.equal(groups[0].capacity_unknown, true);
  assert.equal(groups[0].remaining_kg, null);
});

test('el espacio justo cabe (igual al peso) y un gramo de más no', () => {
  assert.equal(plan([pkg('A', 40)], [trip('V', 40)]).groups.length, 1);
  assert.equal(plan([pkg('A', 40.1)], [trip('V', 40)]).groups.length, 0);
});

test('un viaje con más de 10 paquetes se parte en grupos de máximo 10 (límite de una propuesta)', () => {
  const many = Array.from({ length: 23 }, (_, i) => pkg(`TRK-${i}`, 1, { created_at: h(-100 + i) }));
  const { groups } = plan(many, [trip('V1', 1000)]);
  assert.deepEqual(groups.map((g) => g.packages.length), [10, 10, 3]);
  assert.ok(groups.every((g) => g.route_ref === 'V1'));
});

test('sin paquetes o sin viajes no falla', () => {
  assert.deepEqual(plan([], [trip('V1', 10)]), { groups: [], unassigned: [] });
  assert.equal(plan([pkg('A', 1)], []).unassigned.length, 1);
});

test('no modifica los datos de entrada', () => {
  const trips = [trip('V1', 100)];
  const copy = JSON.parse(JSON.stringify(trips));
  plan([pkg('A', 10)], trips);
  assert.deepEqual(trips, copy);
});

// ============================================================ herramienta
// la herramienta usa Date.now() (reloj real): sus viajes de ejemplo se definen respecto a él, no al NOW fijo de arriba
const hReal = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

const makeDb = ({ loose = [], routes = [], vehicles = [], loads = [] } = {}) => ({
  from: (table) => {
    const b = {
      select: () => b, is: () => b, eq: () => b, gte: () => b, lte: () => b, in: () => b, order: () => b,
      limit: () => b,
      then: (res, rej) => Promise.resolve({
        data: table === 'packages' ? (b._loose ? loose : loads) : table === 'transport_routes' ? routes : vehicles,
        error: null,
      }).then(res, rej),
    };
    // la consulta de paquetes sueltos usa .is('route_id', null); la de cargas usa .in('route_id', ids)
    b.is = () => { b._loose = true; return b; };
    return b;
  },
});

const run = (user, db) => buildSuggestionTools(user, db)[0].invoke({});

test('la herramienta devuelve grupos, lo que no se pudo asignar y un aviso de que no se asignó nada', async () => {
  const db = makeDb({
    loose: [pkg('TRK-1', 10), pkg('TRK-9', 5, { destino: 'Sucre' })],
    routes: [{ id: 'r1', route_code: 'RT-1', origin: 'Cochabamba', destination: 'La Paz', departure_time: hReal(24), vehicle_id: 'v1' }],
    vehicles: [{ id: 'v1', plate: 'ABC-123', brand: 'Volvo', model: 'FH16', capacity_kg: 1000 }],
    loads: [{ route_id: 'r1', peso: 100 }],
  });
  const out = JSON.parse(await run(ADMIN, db));
  assert.equal(out.kind, 'assignment_suggestions');
  assert.equal(out.total_loose, 2);
  assert.equal(out.assignable, 1);
  assert.equal(out.groups[0].route_ref, 'RT-1');
  assert.equal(out.groups[0].free_kg, 900);
  assert.equal(out.unassigned[0].tracking_code, 'TRK-9');
  assert.match(out.instruction, /no se ha asignado nada/i);
});

test('sin paquetes sueltos devuelve una lista vacía (no falla)', async () => {
  const out = JSON.parse(await run(OPERATOR, makeDb()));
  assert.deepEqual([out.total_loose, out.assignable, out.groups, out.unassigned], [0, 0, [], []]);
});

test('SEGURIDAD: solo administradores y operadores consultan las sugerencias', async () => {
  for (const user of [CLIENT, DRIVER]) assert.match(await run(user, makeDb({ loose: [pkg('A', 1)] })), /no tienes permiso/i);
  assert.ok(!toolsForUser(CLIENT).some((t) => t.name === 'suggest_assignments'));
  assert.ok(!toolsForUser(DRIVER).some((t) => t.name === 'suggest_assignments'));
  assert.ok(toolsForUser(ADMIN).some((t) => t.name === 'suggest_assignments'));
  assert.ok(toolsForUser(OPERATOR).some((t) => t.name === 'suggest_assignments'));
});

test('la tarjeta de sugerencias llega al navegador', () => {
  const msgs = [{ type: 'tool', content: JSON.stringify({ kind: 'assignment_suggestions', groups: [] }) }];
  assert.deepEqual(extractAttachments(msgs).map((a) => a.kind), ['assignment_suggestions']);
});

// ============================================================ preparar la asignación (botón, sin modelo)
const PKGS = {
  'TRK-1': { id: 'p1', tracking_code: 'TRK-1', status: 'pendiente', origen: 'Cochabamba', destino: 'La Paz', peso: 10, route_id: null },
  'TRK-2': { id: 'p2', tracking_code: 'TRK-2', status: 'entregado', origen: 'Cochabamba', destino: 'La Paz', peso: 10, route_id: null },
};
const assignDb = (route = { id: 'r1', route_code: 'RT-1', origin: 'Cochabamba', destination: 'La Paz', status: 'planeada', departure_time: hReal(24), vehicle_id: 'v1' }, freeCapacity = 1000) => ({
  from: (table) => {
    const entry = { eq: [] };
    const b = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c, v) => { entry.eq.push([c, v]); return b; },
      insert: () => { throw new Error('preparar no debe escribir'); },
      update: () => { throw new Error('preparar no debe escribir'); },
      maybeSingle: async () => {
        if (table === 'packages') return { data: PKGS[entry.eq.find(([c]) => c === 'tracking_code')?.[1]] ?? null, error: null };
        if (table === 'transport_routes') return { data: route, error: null };
        if (table === 'vehicles') return { data: { capacity_kg: freeCapacity }, error: null };
        return { data: null, error: null };
      },
      then: (res, rej) => Promise.resolve({ data: table === 'packages' ? [] : [], error: null }).then(res, rej),
    };
    return b;
  },
});

test.beforeEach(() => _resetProposals());

test('preparar una asignación devuelve la propuesta a confirmar y NO escribe nada', async () => {
  const out = JSON.parse(await prepareAssignProposal(ADMIN, assignDb(), { codes: ['TRK-1'], route_ref: 'RT-1' }));
  assert.equal(out.kind, 'action_proposal');
  assert.equal(out.action.type, 'assign_package');
  assert.match(out.instruction, /NO se ha ejecutado/);
});

test('rechaza con un motivo si el paquete ya no es asignable o el viaje no tiene espacio', async () => {
  const done = JSON.parse(await prepareAssignProposal(ADMIN, assignDb(), { codes: ['TRK-1', 'TRK-2'], route_ref: 'RT-1' }));
  assert.equal(done.skipped[0].code, 'TRK-2'); // se omite el entregado, se prepara el resto
  const full = await prepareAssignProposal(ADMIN, assignDb(undefined, 5), { codes: ['TRK-1'], route_ref: 'RT-1' });
  assert.match(full, /no tiene espacio/i);
  const started = await prepareAssignProposal(ADMIN, assignDb({ id: 'r1', origin: 'a', destination: 'b', status: 'en_transito', vehicle_id: null }), { codes: ['TRK-1'], route_ref: 'RT-1' });
  assert.match(started, /no está disponible|no está planeado/i);
});

test('SEGURIDAD: un cliente o un conductor no pueden preparar asignaciones', async () => {
  for (const user of [CLIENT, DRIVER]) assert.match(await prepareAssignProposal(user, assignDb(), { codes: ['TRK-1'], route_ref: 'RT-1' }), /no tienes permiso/i);
});

// ============================================================ endpoint
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('POST /suggestions/assign: 200 con la propuesta, 403 sin permiso, 409 si no se puede, 400 si el cuerpo es inválido', async () => {
  controller._useDb(assignDb());
  const ok = res();
  await controller.handlePrepareAssignment({ user: ADMIN, body: { route_ref: 'RT-1', codes: ['TRK-1'] } }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.kind, 'action_proposal');

  const denied = res();
  await controller.handlePrepareAssignment({ user: CLIENT, body: { route_ref: 'RT-1', codes: ['TRK-1'] } }, denied);
  assert.equal(denied.code, 403);

  const nothing = res();
  await controller.handlePrepareAssignment({ user: ADMIN, body: { route_ref: 'RT-1', codes: ['TRK-2'] } }, nothing);
  assert.equal(nothing.code, 409);
  assert.match(nothing.body.message, /ningún paquete que se pueda asignar/i);

  for (const body of [{}, { route_ref: 'RT-1', codes: [] }, { route_ref: 'RT-1', codes: Array.from({ length: 11 }, (_, i) => `TRK-${i}`) }, { route_ref: '', codes: ['TRK-1'] }]) {
    const bad = res();
    await controller.handlePrepareAssignment({ user: ADMIN, body }, bad);
    assert.equal(bad.code, 400, JSON.stringify(body));
  }
  controller._useDb();
});

// ============================================================ atajo e intención
test('el atajo reconoce los pedidos de sugerencias y de paquetes sueltos', () => {
  const all = toolsForUser(ADMIN).map((t) => t.name);
  for (const q of ['Sugiere asignaciones', '¿Qué paquetes sueltos hay?', 'Sugiere cómo asignar los paquetes sueltos', '¿Qué paquetes puedo asignar?', 'Hay carga suelta?']) {
    assert.equal(fastPlanFor(all, q)?.tool, 'suggest_assignments', q);
  }
  assert.equal(fastPlanFor(toolsForUser(CLIENT).map((t) => t.name), 'Sugiere asignaciones'), null, 'un cliente no tiene esa herramienta');
  assert.equal(fastPlanFor(all, 'Asigna TRK-1 al viaje RT-1'), null, 'una orden concreta no es una sugerencia');
});

test('la intención "suggest" trae la herramienta de sugerencias y la de proponer asignación', () => {
  assert.ok(intentsOf('¿Qué paquetes sueltos hay?').includes('suggest'));
  const names = selectToolNames(toolsForUser(ADMIN).map((t) => t.name), '¿Qué paquetes sueltos hay y a qué viaje van?');
  assert.ok(names.includes('suggest_assignments') && names.includes('propose_assign_package'));
});
