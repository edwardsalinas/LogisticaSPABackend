import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _resetProposals, confirmProposal } from '../../src/modules/ai-agent/ai-actions.service.js';
import { applyPlan, buildPlanTools, MAX_PLAN_STEPS, PLAN_ACTION_NAMES, preparePlanProposal } from '../../src/modules/ai-agent/ai-agent.plan.js';
import { toolsForUser } from '../../src/modules/ai-agent/ai-agent.tools.js';

const NOW = Date.parse('2026-11-26T16:00:00Z');
const ADMIN = { id: 'a1', role: 'admin' };
const OPERATOR = { id: 'o1', role: 'logistics_operator' };
const CLIENT = { id: 'c1', role: 'client' };
const DRIVER = { id: 'd1', role: 'driver' };
const inH = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
const parse = (s) => JSON.parse(s);

/** Base simulada con tablas que se pueden modificar (eq, in, ilike, limit, order, maybeSingle y conteos). */
const fakeDb = (tables) => {
  const from = (name) => {
    const q = { filters: [], limit: null };
    const run = () => {
      let r = (tables[name] ?? []).filter((row) => q.filters.every((f) => f(row)));
      if (q.limit != null) r = r.slice(0, q.limit);
      return { data: r, error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: (n) => { q.limit = n; return b; },
      eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
      in: (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return b; },
      ilike: (c, pattern) => { const needle = pattern.replace(/%/g, '').toLowerCase(); q.filters.push((r) => String(r[c]).toLowerCase().includes(needle)); return b; },
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, tables };
};

const trip = (o = {}) => ({ id: 'r1', route_code: 'RT-1', origin: 'Oruro', destination: 'La Paz', status: 'planeada', departure_time: inH(20), estimated_arrival: inH(24), driver_id: null, vehicle_id: null, ...o });
const NEW_PKG = { action: 'create_package', origen: 'Oruro', destino: 'La Paz', peso: 3, recipient_name: 'Ana Pérez' };
const ASSIGN_NEW = { action: 'assign_package', codes: ['$1'], route_ref: 'RT-1' };

/** Ejecutores simulados: crear agrega el paquete a la «base»; asignar lo mueve al viaje. Registran el orden en que corrieron. */
const executorsFor = (db, calls) => ({
  create_package: async (p) => {
    calls.push('create');
    db.tables.packages.push({ id: 'p-new', tracking_code: 'TRK-NEW', status: 'pendiente', origen: p.data.origen, destino: p.data.destino, peso: p.data.peso, route_id: null });
    return { message: 'Paquete creado con el código TRK-NEW.', data: { tracking_code: 'TRK-NEW' } };
  },
  assign_package: async (p) => {
    calls.push(`assign:${p.items.map((i) => i.tracking_code).join(',')}`);
    for (const i of p.items) Object.assign(db.tables.packages.find((x) => x.id === i.package_id), { route_id: p.route_id, status: 'asignado' });
    return { message: `Paquete ${p.items[0].tracking_code} asignado al viaje.`, data: { results: p.items.map((i) => ({ tracking_code: i.tracking_code, ok: true })) } };
  },
});

test.beforeEach(() => _resetProposals());

test('plan: crear un paquete y asignarlo se propone UNA vez, con los dos pasos a la vista, y no ejecuta nada', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  const out = parse(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, ASSIGN_NEW] }, NOW));
  assert.equal(out.action.type, 'plan');
  assert.equal(out.action.title, 'Plan de 2 pasos');
  assert.match(out.action.lines[0], /^1\. Registrar un paquete/);
  assert.match(out.action.lines[1], /^2\. Asignar a un viaje: el paquete del paso 1 → Oruro → La Paz/);
  assert.ok(out.action.lines.at(-1).includes('UNA confirmación'));
  assert.equal(db.tables.packages.length, 0);
});

test('plan: al confirmar corre en orden y el paso 2 ya ve el paquete creado por el paso 1', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  const calls = [];
  const exec = executorsFor(db, calls);
  const out = parse(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, ASSIGN_NEW] }, NOW));
  const res = await confirmProposal(out.action.id, OPERATOR, { plan: (p, u) => applyPlan(p, u, db, exec) }, NOW);
  assert.deepEqual(calls, ['create', 'assign:TRK-NEW']);
  assert.match(res.message, /Plan completo \(2 pasos\)/);
  assert.deepEqual(res.data.results, [{ tracking_code: 'TRK-NEW', ok: true }]); // un solo recibo, sin repetir el código
  assert.equal(db.tables.packages[0].route_id, 'r1');
});

test('plan: si un paso falla se DETIENE, dice qué quedó hecho y no sigue', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  const calls = [];
  const exec = executorsFor(db, calls);
  exec.assign_package = async () => { calls.push('assign'); throw new Error('el viaje se llenó'); };
  const out = parse(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, ASSIGN_NEW, { action: 'register_event', code: '$1', status: 'en_agencia' }] }, NOW));
  await assert.rejects(
    confirmProposal(out.action.id, OPERATOR, { plan: (p, u) => applyPlan(p, u, db, exec) }, NOW),
    (e) => /se detuvo en el paso 2/.test(e.message) && /el viaje se llenó/.test(e.message) && /Quedó hecho: 1\. Paquete creado/.test(e.message) && /Faltó 1 paso/.test(e.message) && e.status === 409,
  );
  assert.deepEqual(calls, ['create', 'assign']); // el paso 3 nunca corrió
});

test('plan: un paso que ya no se puede (el viaje salió entre proponer y confirmar) frena el plan antes de asignar', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  const calls = [];
  const exec = executorsFor(db, calls);
  const out = parse(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, ASSIGN_NEW] }, NOW));
  db.tables.transport_routes[0].status = 'en_transito';
  await assert.rejects(confirmProposal(out.action.id, OPERATOR, { plan: (p, u) => applyPlan(p, u, db, exec) }, NOW), /se detuvo en el paso 2/);
  assert.deepEqual(calls, ['create']);
});

test('plan: rechaza lo que no debe ir en un plan (irreversible, desconocido, demasiado largo o corto)', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG] }, NOW), /al menos dos pasos/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'cancel_trip', route_ref: 'RT-1' }] }, NOW), /no se puede incluir en un plan/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'deliver_package', code: '$1' }] }, NOW), /no se puede incluir en un plan/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'borrar_todo' }] }, NOW), /no se puede incluir/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: Array(MAX_PLAN_STEPS + 1).fill(NEW_PKG) }, NOW), /hasta 4 pasos/);
  assert.ok(!PLAN_ACTION_NAMES.some((n) => /cancel|deliver|retire/.test(n)));
});

test('plan: las referencias $n deben apuntar a un paso anterior que cree un paquete', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [ASSIGN_NEW, NEW_PKG] }, NOW), /no crea un paquete anterior/); // apunta hacia adelante
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'assign_package', codes: ['$2'], route_ref: 'RT-1' }] }, NOW), /no crea un paquete anterior/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'create_trip', code: '$1', origin: 'Oruro', destination: 'La Paz', date: '2026-11-28', time: '09:00' }] }, NOW), /no puede apoyarse/);
});

test('plan: valida lo que se puede al proponer (viaje inexistente, sin espacio, datos del paquete incompletos)', async () => {
  const db = fakeDb({ transport_routes: [trip({ vehicle_id: 'v1' })], vehicles: [{ id: 'v1', capacity_kg: 2 }], packages: [] });
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { ...ASSIGN_NEW, route_ref: 'NOEXISTE' }] }, NOW), /Paso 2: No encontré ese viaje/);
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, ASSIGN_NEW] }, NOW), /Paso 2: El viaje no tiene espacio/); // 3 kg en un vehículo de 2
  assert.match(await preparePlanProposal(OPERATOR, db, { steps: [{ action: 'create_package', origen: 'Oruro' }, ASSIGN_NEW] }, NOW), /Paso 1 \(Registrar un paquete\): Faltan/);
});

test('plan: no deja propuestas sueltas confirmables (los pasos se validan y se descartan)', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  const solo = parse(await preparePlanProposal(OPERATOR, db, { steps: [NEW_PKG, { action: 'create_package', origen: 'Oruro', destino: 'La Paz', peso: 1, recipient_name: 'Luis' }] }, NOW));
  // confirmar el plan es lo único posible: el servidor tiene UNA propuesta pendiente, la del plan
  const calls = [];
  const exec = executorsFor(db, calls);
  await confirmProposal(solo.action.id, OPERATOR, { plan: (p, u) => applyPlan(p, u, db, exec) }, NOW);
  assert.deepEqual(calls, ['create', 'create']);
});

test('plan: solo personal; cliente y conductor no lo ven ni lo proponen', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [] });
  for (const u of [CLIENT, DRIVER]) assert.match(await preparePlanProposal(u, db, { steps: [NEW_PKG, ASSIGN_NEW] }, NOW), /No tienes permiso/);
  const names = (role) => toolsForUser({ id: 'x', role }, {}, {}).map((t) => t.name);
  assert.ok(names('admin').includes('propose_plan') && names('logistics_operator').includes('propose_plan'));
  assert.ok(!names('client').includes('propose_plan') && !names('driver').includes('propose_plan'));
  assert.equal(buildPlanTools(ADMIN, db)[0].name, 'propose_plan');
});
