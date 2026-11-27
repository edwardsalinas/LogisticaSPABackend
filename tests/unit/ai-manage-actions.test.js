import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _resetProposals, confirmProposal } from '../../src/modules/ai-agent/ai-actions.service.js';
import {
  applyCancelTrip, applyCreateVehicle, applyRescheduleTrip, applyUpdateVehicle,
  prepareCancelTripProposal, prepareCreateVehicleProposal, prepareRescheduleProposal, prepareUpdateVehicleProposal,
} from '../../src/modules/ai-agent/ai-agent.manage-actions.js';
import { toolsForUser } from '../../src/modules/ai-agent/ai-agent.tools.js';

const NOW = Date.parse('2026-11-26T16:00:00Z'); // 12:00 en Bolivia
const ADMIN = { id: 'a1', role: 'admin' };
const OPERATOR = { id: 'o1', role: 'logistics_operator' };
const CLIENT = { id: 'c1', role: 'client' };
const DRIVER = { id: 'd1', role: 'driver' };
const inH = (h) => new Date(NOW + h * 3600 * 1000).toISOString();

/** Base simulada del cliente de Supabase: eq, ilike, in, limit, maybeSingle, update y conteo. Registra las modificaciones. */
const fakeDb = (tables) => {
  const updates = [];
  const from = (name) => {
    const q = { filters: [], limit: null, update: null, count: false };
    const run = () => {
      let r = (tables[name] ?? []).filter((row) => q.filters.every((f) => f(row)));
      const total = r.length;
      if (q.limit != null) r = r.slice(0, q.limit);
      if (q.update) { for (const row of r) Object.assign(row, q.update); updates.push({ table: name, payload: q.update, n: r.length }); return { data: null, error: null }; }
      return { data: r, error: null, ...(q.count ? { count: total } : {}) };
    };
    const b = {
      select: (_c, opt) => { if (opt?.count) q.count = true; return b; },
      limit: (n) => { q.limit = n; return b; },
      eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
      in: (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return b; },
      ilike: (c, pattern) => { const needle = pattern.replace(/%/g, '').toLowerCase(); q.filters.push((r) => String(r[c]).toLowerCase().includes(needle)); return b; },
      update: (p) => { q.update = p; return b; },
      maybeSingle: async () => { const row = run().data?.[0]; return { data: row ? { ...row } : null, error: null }; }, // una copia, como una base real
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, updates, tables };
};

const trip = (o = {}) => ({ id: 'r1', route_code: 'RT-1', origin: 'Oruro', destination: 'La Paz', status: 'planeada', departure_time: inH(5), estimated_arrival: inH(9), driver_id: null, vehicle_id: null, ...o });
const vehicle = (o = {}) => ({ id: 'v1', plate: 'ABC-1234', brand: 'Volvo', model: 'FH', status: 'disponible', capacity_kg: 8000, ...o });
const parse = (s) => JSON.parse(s);

test.beforeEach(() => _resetProposals());

// ============================================================ reprogramar
test('reprogramar: propone la nueva hora y NO modifica nada; avisa si lleva paquetes', async () => {
  const db = fakeDb({ transport_routes: [trip()], packages: [{ id: 'p1', route_id: 'r1' }, { id: 'p2', route_id: 'r1' }] });
  const out = parse(await prepareRescheduleProposal(OPERATOR, db, { route_ref: 'RT-1', date: '2026-11-28', time: '08:30' }, NOW));
  assert.equal(out.action.type, 'reschedule_trip');
  assert.ok(out.action.lines.some((l) => /2 paquetes asignados/.test(l)));
  assert.equal(db.updates.length, 0);
  assert.equal(out.action.title, 'Reprogramar un viaje');
});

test('reprogramar: solo el personal, solo viajes planeados y solo a una hora futura', async () => {
  const db = fakeDb({ transport_routes: [trip(), trip({ id: 'r2', route_code: 'RT-2', status: 'en_transito' })] });
  for (const u of [CLIENT, DRIVER]) assert.match(await prepareRescheduleProposal(u, db, { route_ref: 'RT-1', date: '2026-11-28', time: '08:30' }, NOW), /No tienes permiso/);
  assert.match(await prepareRescheduleProposal(OPERATOR, db, { route_ref: 'RT-2', date: '2026-11-28', time: '08:30' }, NOW), /ya no está planeado/);
  assert.match(await prepareRescheduleProposal(OPERATOR, db, { route_ref: 'RT-1', date: '2026-11-25', time: '08:30' }, NOW), /ya pasaron|futura/);
  assert.match(await prepareRescheduleProposal(OPERATOR, db, { route_ref: 'NOEXISTE', date: '2026-11-28', time: '08:30' }, NOW), /No encontré ese viaje/);
});

test('reprogramar: al confirmar corre la llegada lo mismo y vuelve a comprobar el estado', async () => {
  const db = fakeDb({ transport_routes: [trip()] });
  const out = parse(await prepareRescheduleProposal(ADMIN, db, { route_ref: 'RT-1', date: '2026-11-28', time: '08:30' }, NOW));
  const before = db.tables.transport_routes[0];
  const dep0 = Date.parse(before.departure_time); const eta0 = Date.parse(before.estimated_arrival);
  const res = await confirmProposal(out.action.id, ADMIN, { reschedule_trip: (p) => applyRescheduleTrip(db, p) }, NOW);
  assert.equal(res.message, 'Viaje reprogramado.');
  const after = db.tables.transport_routes[0];
  const delta = Date.parse(after.departure_time) - dep0;
  assert.ok(delta > 0);
  assert.equal(Date.parse(after.estimated_arrival) - eta0, delta);
  // si el viaje salió entre proponer y confirmar, no se toca
  db.tables.transport_routes[0].status = 'en_transito';
  await assert.rejects(applyRescheduleTrip(db, { route_id: 'r1', departure_time: inH(30) }), /ya no está planeado/);
});

// ============================================================ cancelar viaje
test('cancelar viaje: avisa cuántos paquetes vuelven a pendiente; solo planeados; el cliente no puede', async () => {
  const db = fakeDb({ transport_routes: [trip(), trip({ id: 'r2', route_code: 'RT-2', status: 'completada' })], packages: [{ id: 'p1', route_id: 'r1' }] });
  const out = parse(await prepareCancelTripProposal(OPERATOR, db, { route_ref: 'RT-1' }, NOW));
  assert.equal(out.action.type, 'cancel_trip');
  assert.ok(out.action.lines.some((l) => /1 paquete asignado, que volverá/.test(l)));
  assert.ok(out.action.lines.some((l) => /no se puede deshacer/.test(l)));
  assert.equal(db.updates.length, 0);
  assert.match(await prepareCancelTripProposal(OPERATOR, db, { route_ref: 'RT-2' }, NOW), /Solo se pueden cancelar viajes planeados/);
  assert.match(await prepareCancelTripProposal(CLIENT, db, { route_ref: 'RT-1' }, NOW), /No tienes permiso/);
});

test('cancelar viaje: al confirmar usa el servicio de borrado y no toca un viaje que ya salió', async () => {
  const db = fakeDb({ transport_routes: [trip()] });
  const deleted = [];
  const res = await applyCancelTrip(db, { route_id: 'r1' }, async (id) => deleted.push(id));
  assert.deepEqual(deleted, ['r1']);
  assert.equal(res.message, 'Viaje cancelado.');
  db.tables.transport_routes[0].status = 'en_transito';
  await assert.rejects(applyCancelTrip(db, { route_id: 'r1' }, async () => deleted.push('x')), /ya no está planeado/);
  assert.deepEqual(deleted, ['r1']);
});

// ============================================================ crear vehículo
test('crear vehículo: valida con el esquema de siempre, rechaza placas repetidas y es solo del administrador', async () => {
  const db = fakeDb({ vehicles: [vehicle()] });
  const ok = parse(await prepareCreateVehicleProposal(ADMIN, db, { plate: 'xyz 5678', brand: 'Scania', model: 'R450', type: 'camion', capacity_kg: 12000 }, NOW));
  assert.equal(ok.action.type, 'create_vehicle');
  assert.ok(ok.action.lines.some((l) => /XYZ5678/.test(l)));
  assert.match(await prepareCreateVehicleProposal(ADMIN, db, { plate: 'abc-1234', model: 'FH', type: 'camion', capacity_kg: 100 }, NOW), /Ya existe un vehículo con la placa/);
  assert.match(await prepareCreateVehicleProposal(ADMIN, db, { plate: 'a', model: 'x', type: 'c', capacity_kg: -5 }, NOW), /Faltan o no son válidos/);
  for (const u of [OPERATOR, CLIENT, DRIVER]) assert.match(await prepareCreateVehicleProposal(u, db, { plate: 'xyz5678', model: 'R450', type: 'camion', capacity_kg: 1 }, NOW), /Solo un administrador/);
  assert.equal(db.updates.length, 0);
});

test('crear vehículo: al confirmar lo registra una vez, y el operador no puede confirmarlo', async () => {
  const db = fakeDb({ vehicles: [] });
  const created = [];
  const exec = { create_vehicle: (p) => applyCreateVehicle(db, p, async (v) => { created.push(v); db.tables.vehicles.push({ id: 'n1', ...v }); return { id: 'n1' }; }) };
  const out = parse(await prepareCreateVehicleProposal(ADMIN, db, { plate: 'xyz5678', model: 'R450', type: 'camion', capacity_kg: 12000 }, NOW));
  const res = await confirmProposal(out.action.id, ADMIN, exec, NOW);
  assert.match(res.message, /XYZ5678 registrado/);
  assert.equal(created.length, 1);
  await assert.rejects(applyCreateVehicle(db, { vehicle: { plate: 'XYZ5678' } }, async () => ({})), /Ya existe/); // doble confirmación
  _resetProposals();
  const again = parse(await prepareCreateVehicleProposal(ADMIN, fakeDb({ vehicles: [] }), { plate: 'qqq1234', model: 'M1', type: 'camion', capacity_kg: 5 }, NOW));
  await assert.rejects(confirmProposal(again.action.id, OPERATOR, exec, NOW), /no existe|permiso/i); // la propuesta es de quien la pidió
});

// ============================================================ cambiar o retirar vehículo
test('vehículo: retirar propone el cambio y aclara que no se borra; avisa de los viajes planeados', async () => {
  const db = fakeDb({ vehicles: [vehicle()], transport_routes: [trip({ vehicle_id: 'v1' })] });
  const out = parse(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'abc', status: 'retirado' }, NOW));
  assert.equal(out.action.type, 'update_vehicle');
  assert.equal(out.action.title, 'Retirar un vehículo');
  assert.ok(out.action.lines.some((l) => /no lo borra/.test(l)));
  assert.ok(out.action.lines.some((l) => /1 viaje planeado/.test(l)));
  assert.equal(db.updates.length, 0);
});

test('vehículo: un viaje en tránsito bloquea retirarlo o ponerlo en mantenimiento, también al confirmar', async () => {
  const db = fakeDb({ vehicles: [vehicle()], transport_routes: [trip({ vehicle_id: 'v1', status: 'en_transito' })] });
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', status: 'mantenimiento' }, NOW), /en un viaje en tránsito/);
  await assert.rejects(applyUpdateVehicle(db, { vehicle_id: 'v1', plate: 'ABC-1234', patch: { status: 'retirado' } }), /en tránsito/);
  assert.equal(db.updates.length, 0);
});

test('vehículo: rechaza estados inventados, capacidades absurdas, cambios que no cambian nada y a quien no es administrador', async () => {
  const db = fakeDb({ vehicles: [vehicle(), vehicle({ id: 'v2', plate: 'ABC-9999' })] });
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', status: 'volando' }, NOW), /no existe/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', status: 'disponible' }, NOW), /ya está disponible/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', capacity_kg: -1 }, NOW), /capacidad debe ser/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', capacity_kg: 8000 }, NOW), /ya tiene esa capacidad/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC' }, NOW), /varios vehículos/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234' }, NOW), /Indica qué cambiar/);
  assert.match(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ZZZ-0000', status: 'retirado' }, NOW), /No encontré/);
  for (const u of [OPERATOR, CLIENT, DRIVER]) assert.match(await prepareUpdateVehicleProposal(u, db, { plate: 'ABC-1234', status: 'retirado' }, NOW), /Solo un administrador/);
});

test('vehículo: al confirmar aplica solo el cambio pedido', async () => {
  const db = fakeDb({ vehicles: [vehicle()] });
  const out = parse(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', capacity_kg: 9500 }, NOW));
  const res = await confirmProposal(out.action.id, ADMIN, { update_vehicle: (p) => applyUpdateVehicle(db, p) }, NOW);
  assert.match(res.message, /ABC-1234 actualizado/);
  assert.deepEqual(db.updates.map((u) => u.payload), [{ capacity_kg: 9500 }]);
  assert.equal(db.tables.vehicles[0].status, 'disponible');
});

// ============================================================ quién ve las herramientas
test('las herramientas nuevas llegan solo a quien puede usarlas', () => {
  const names = (role) => toolsForUser({ id: 'x', role }, {}, {}).map((t) => t.name);
  assert.ok(names('admin').includes('propose_create_vehicle') && names('admin').includes('propose_update_vehicle'));
  assert.ok(names('admin').includes('propose_reschedule_trip') && names('admin').includes('propose_cancel_trip'));
  assert.ok(names('logistics_operator').includes('propose_reschedule_trip') && names('logistics_operator').includes('propose_cancel_trip'));
  assert.ok(!names('logistics_operator').includes('propose_create_vehicle') && !names('logistics_operator').includes('propose_update_vehicle'));
  for (const role of ['client', 'driver']) assert.ok(!names(role).some((n) => /reschedule|cancel_trip|vehicle/.test(n)), role);
});

// ============================================================ deshacer (del servidor)
import { _resetUndo, registerUndo, runUndo, UNDO_TTL_MS } from '../../src/modules/ai-agent/ai-actions.service.js';
import { undoRescheduleTrip, undoUpdateVehicle } from '../../src/modules/ai-agent/ai-agent.manage-actions.js';

test.beforeEach(() => _resetUndo());

test('deshacer reprogramar: la confirmación entrega un identificador (nunca los datos) y devuelve el viaje a su hora', async () => {
  const db = fakeDb({ transport_routes: [trip()] });
  const original = db.tables.transport_routes[0].departure_time;
  const out = parse(await prepareRescheduleProposal(ADMIN, db, { route_ref: 'RT-1', date: '2026-11-28', time: '08:30' }, NOW));
  const res = await confirmProposal(out.action.id, ADMIN, { reschedule_trip: (p) => applyRescheduleTrip(db, p) }, NOW);
  assert.ok(res.data.undo.id);
  assert.equal(res.data.undo.label, 'Volver a la hora anterior');
  assert.deepEqual(Object.keys(res.data.undo).sort(), ['expires_at', 'id', 'label']); // el navegador no recibe parámetros
  assert.notEqual(db.tables.transport_routes[0].departure_time, original);
  const undone = await runUndo(res.data.undo.id, ADMIN, { reschedule_trip: (u) => undoRescheduleTrip(db, u) }, NOW);
  assert.match(undone.message, /volvió a su hora anterior/);
  assert.equal(db.tables.transport_routes[0].departure_time, original);
});

test('deshacer: un solo uso, solo quien lo hizo, y vence a los 30 minutos', async () => {
  const exec = { reschedule_trip: async () => ({ message: 'ok' }) };
  const spec = { type: 'reschedule_trip', label: 'x', params: {} };
  const ref = registerUndo(ADMIN, spec, NOW);
  await assert.rejects(runUndo(ref.id, OPERATOR, exec, NOW), /No hay nada que deshacer/); // ajeno = inexistente
  await runUndo(ref.id, ADMIN, exec, NOW);
  await assert.rejects(runUndo(ref.id, ADMIN, exec, NOW), /ya se deshizo/);
  const late = registerUndo(ADMIN, spec, NOW);
  await assert.rejects(runUndo(late.id, ADMIN, exec, NOW + UNDO_TTL_MS + 1), /Ya pasó el tiempo/);
  await assert.rejects(runUndo('no-existe', ADMIN, exec, NOW), /No hay nada que deshacer/);
});

test('deshacer: se re-comprueba el rol y un fallo permite reintentar', async () => {
  const ref = registerUndo(CLIENT, { type: 'update_vehicle', label: 'x', params: {} }, NOW);
  await assert.rejects(runUndo(ref.id, CLIENT, { update_vehicle: async () => ({ message: 'ok' }) }, NOW), /permiso/);
  let n = 0;
  const flaky = registerUndo(ADMIN, { type: 'update_vehicle', label: 'x', params: {} }, NOW);
  const exec = { update_vehicle: async () => { n += 1; if (n === 1) throw new Error('falló'); return { message: 'ok' }; } };
  await assert.rejects(runUndo(flaky.id, ADMIN, exec, NOW), /falló/);
  assert.equal((await runUndo(flaky.id, ADMIN, exec, NOW)).message, 'ok');
});

test('deshacer reprogramar: si el viaje salió o alguien lo movió después, NO se devuelve', async () => {
  const dbA = fakeDb({ transport_routes: [trip({ departure_time: inH(30) })] });
  const u = { route_id: 'r1', now: inH(30), before: inH(5), beforeEta: inH(9) };
  dbA.tables.transport_routes[0].status = 'en_transito';
  await assert.rejects(undoRescheduleTrip(dbA, u), /ya salió o terminó/);
  const dbB = fakeDb({ transport_routes: [trip({ departure_time: inH(48) })] }); // otra persona lo movió a otra hora
  await assert.rejects(undoRescheduleTrip(dbB, u), /Alguien cambió la hora/);
  assert.equal(dbB.updates.length, 0);
});

test('deshacer vehículo: vuelve a su estado y capacidad, pero no si alguien lo cambió después', async () => {
  const db = fakeDb({ vehicles: [vehicle()] });
  const out = parse(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', status: 'mantenimiento', capacity_kg: 9000 }, NOW));
  const res = await confirmProposal(out.action.id, ADMIN, { update_vehicle: (p) => applyUpdateVehicle(db, p) }, NOW);
  assert.equal(db.tables.vehicles[0].status, 'mantenimiento');
  await runUndo(res.data.undo.id, ADMIN, { update_vehicle: (u) => undoUpdateVehicle(db, u) }, NOW);
  assert.equal(db.tables.vehicles[0].status, 'disponible');
  assert.equal(db.tables.vehicles[0].capacity_kg, 8000);
  // si alguien cambió el vehículo después, no se pisa su cambio
  const db2 = fakeDb({ vehicles: [vehicle({ status: 'retirado' })] });
  await assert.rejects(undoUpdateVehicle(db2, { vehicle_id: 'v1', plate: 'ABC-1234', before: { status: 'disponible' }, after: { status: 'mantenimiento' } }), /Alguien cambió este vehículo/);
});

// ============================================================ borrar vehículo
import { applyDeleteVehicle, applyUpdatePackage, prepareDeleteVehicleProposal, prepareUpdatePackageProposal, undoUpdatePackage } from '../../src/modules/ai-agent/ai-agent.manage-actions.js';

const fakeDelete = (tables) => {
  const db = fakeDb(tables);
  const base = db.from;
  db.deleted = [];
  db.from = (name) => {
    const b = base(name);
    b.delete = () => ({ eq: async (_c, v) => { (tables[name] ?? []).splice((tables[name] ?? []).findIndex((r) => r.id === v), 1); db.deleted.push([name, v]); return { error: null }; } });
    return b;
  };
  return db;
};

test('borrar vehículo: solo el administrador, y solo si nada lo usa', async () => {
  const free = fakeDelete({ vehicles: [vehicle()], transport_routes: [], drivers: [], schedules: [] });
  const out = parse(await prepareDeleteVehicleProposal(ADMIN, free, { plate: 'ABC-1234' }, NOW));
  assert.equal(out.action.type, 'delete_vehicle');
  assert.ok(out.action.lines.some((l) => /no se puede deshacer/.test(l)));
  assert.equal(free.deleted.length, 0);
  for (const u of [OPERATOR, CLIENT, DRIVER]) assert.match(await prepareDeleteVehicleProposal(u, free, { plate: 'ABC-1234' }, NOW), /Solo un administrador/);
  const used = fakeDelete({ vehicles: [vehicle()], transport_routes: [trip({ vehicle_id: 'v1', status: 'completada' })], drivers: [{ id: 'd1', current_vehicle_id: 'v1' }], schedules: [{ id: 's1', vehicle_id: 'v1' }] });
  const msg = await prepareDeleteVehicleProposal(ADMIN, used, { plate: 'ABC-1234' }, NOW);
  assert.match(msg, /todavía lo usan 1 viaje, 1 conductor, 1 programación/);
  assert.match(msg, /retirarse/);
});

test('borrar vehículo: al confirmar vuelve a mirar si lo usan (pudo asignarse entre proponer y confirmar)', async () => {
  const db = fakeDelete({ vehicles: [vehicle()], transport_routes: [], drivers: [], schedules: [] });
  const out = parse(await prepareDeleteVehicleProposal(ADMIN, db, { plate: 'ABC-1234' }, NOW));
  db.tables.transport_routes.push(trip({ vehicle_id: 'v1' })); // alguien lo asignó a un viaje
  await assert.rejects(confirmProposal(out.action.id, ADMIN, { delete_vehicle: (p) => applyDeleteVehicle(db, p) }, NOW), /Ya no se puede borrar: ahora lo usan 1 viaje/);
  assert.equal(db.deleted.length, 0);
  db.tables.transport_routes.length = 0;
  const again = parse(await prepareDeleteVehicleProposal(ADMIN, db, { plate: 'ABC-1234' }, NOW));
  const res = await confirmProposal(again.action.id, ADMIN, { delete_vehicle: (p) => applyDeleteVehicle(db, p) }, NOW);
  assert.match(res.message, /ABC-1234 borrado/);
  assert.equal(res.data.undo, undefined); // borrar no se deshace
});

// ============================================================ editar paquete
const pkg = (o = {}) => ({ id: 'p1', tracking_code: 'TRK-1', status: 'pendiente', route_id: null, recipient_name: 'Ana Pérez', recipient_phone: '70000000', peso: 3, description: 'ropa', ...o });

test('editar paquete: propone solo lo que cambia, con antes → después, y no modifica nada', async () => {
  const db = fakeDb({ packages: [pkg()] });
  const out = parse(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', recipient_name: 'Ana Pérez Rojas', peso: 3, description: 'ropa' }, NOW));
  assert.equal(out.action.type, 'update_package');
  assert.deepEqual(out.action.lines, ['Paquete: TRK-1', 'Destinatario: Ana Pérez → Ana Pérez Rojas']); // peso y descripción iguales: no aparecen
  assert.equal(db.updates.length, 0);
});

test('editar paquete: solo pendientes y sin viaje, datos válidos, algo que cambiar y solo el personal', async () => {
  const db = fakeDb({ packages: [pkg(), pkg({ id: 'p2', tracking_code: 'TRK-2', route_id: 'r1', status: 'asignado' }), pkg({ id: 'p3', tracking_code: 'TRK-3', status: 'entregado' })] });
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-2', peso: 5 }, NOW), /ya no se puede editar aquí/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-3', peso: 5 }, NOW), /ya no se puede editar aquí/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-9', peso: 5 }, NOW), /No existe el paquete/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', peso: -2 }, NOW), /Datos inválidos/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', recipient_name: 'A' }, NOW), /Datos inválidos/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1' }, NOW), /Indica qué cambiar/);
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', peso: 3 }, NOW), /ya tiene esos datos/);
  // origen y destino no se editan aquí (cambian la ruta): se ignoran
  assert.match(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', destino: 'Sucre' }, NOW), /Indica qué cambiar/);
  for (const u of [CLIENT, DRIVER]) assert.match(await prepareUpdatePackageProposal(u, db, { code: 'TRK-1', peso: 5 }, NOW), /No tienes permiso/);
});

test('editar paquete: al confirmar aplica solo eso, se puede deshacer, y no si alguien lo editó o lo asignó después', async () => {
  const db = fakeDb({ packages: [pkg()] });
  const out = parse(await prepareUpdatePackageProposal(OPERATOR, db, { code: 'TRK-1', peso: 4.5, recipient_phone: '71111111' }, NOW));
  const res = await confirmProposal(out.action.id, OPERATOR, { update_package: (p) => applyUpdatePackage(db, p) }, NOW);
  assert.deepEqual(db.updates.map((u) => u.payload), [{ peso: 4.5, recipient_phone: '71111111' }]);
  assert.equal(res.data.undo.label, 'Deshacer la edición del paquete');
  await runUndo(res.data.undo.id, OPERATOR, { update_package: (u) => undoUpdatePackage(db, u) }, NOW);
  assert.equal(db.tables.packages[0].peso, 3);
  assert.equal(db.tables.packages[0].recipient_phone, '70000000');
  // si alguien lo cambió después, no se pisa
  await assert.rejects(undoUpdatePackage(fakeDb({ packages: [pkg({ peso: 9 })] }), { package_id: 'p1', tracking_code: 'TRK-1', before: { peso: 3 }, after: { peso: 4.5 } }), /Alguien editó este paquete/);
  // y si ya entró a un viaje, tampoco se edita ni se devuelve
  await assert.rejects(applyUpdatePackage(fakeDb({ packages: [pkg({ status: 'asignado', route_id: 'r1' })] }), { package_id: 'p1', patch: { peso: 5 }, tracking_code: 'TRK-1' }), /ya no se puede editar/);
});

// ============================================================ lo que se deja a la vista al terminar
test('cada acción nueva deja una orden de pantalla con lo que se acaba de hacer', async () => {
  const dbR = fakeDb({ transport_routes: [trip()] });
  assert.deepEqual((await applyRescheduleTrip(dbR, { route_id: 'r1', departure_time: inH(30) })).reveal, { kind: 'ui_command', page: 'routes', search: 'RT-1' });
  const dbC = fakeDb({ transport_routes: [trip()] });
  assert.deepEqual((await applyCancelTrip(dbC, { route_id: 'r1' }, async () => true)).reveal, { kind: 'ui_command', page: 'routes', search: '' });
  const dbV = fakeDb({ vehicles: [] });
  assert.deepEqual((await applyCreateVehicle(dbV, { vehicle: { plate: 'XYZ5678' } }, async () => ({ id: 'n' }))).reveal, { kind: 'ui_command', page: 'fleet', search: 'XYZ5678', tab: 'vehicles' });
  const dbU = fakeDb({ vehicles: [vehicle()] });
  assert.equal((await applyUpdateVehicle(dbU, { vehicle_id: 'v1', plate: 'ABC-1234', patch: { capacity_kg: 9000 } })).reveal.search, 'ABC-1234');
  const dbP = fakeDb({ packages: [pkg()] });
  assert.deepEqual((await applyUpdatePackage(dbP, { package_id: 'p1', tracking_code: 'TRK-1', patch: { peso: 5 }, before: { peso: 3 } })).reveal, { kind: 'ui_command', page: 'packages', search: 'TRK-1' });
});

test('el reveal y el deshacer viajan juntos en el resultado de confirmar', async () => {
  const db = fakeDb({ vehicles: [vehicle()] });
  const out = parse(await prepareUpdateVehicleProposal(ADMIN, db, { plate: 'ABC-1234', capacity_kg: 9000 }, NOW));
  const res = await confirmProposal(out.action.id, ADMIN, { update_vehicle: (p) => applyUpdateVehicle(db, p) }, NOW);
  assert.equal(res.data.reveal.page, 'fleet');
  assert.ok(res.data.undo.id);
});
