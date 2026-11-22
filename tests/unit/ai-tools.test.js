import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTools, canAccessPackage, canAccessRoute } from '../../src/modules/ai-agent/ai-agent.tools.js';
import { chatSchema, providerBusyStatus } from '../../src/modules/ai-agent/ai-agent.controller.js';

// Base de datos simulada: cada tabla devuelve un resultado fijo sin importar los filtros encadenados
const fakeDb = (tables) => ({
  from: (table) => {
    const result = tables[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  },
});

const toolByName = (tools, name) => tools.find((t) => t.name === name);
const PKG = { id: 'p1', tracking_code: 'TRK-1', status: 'en_transito', origen: 'La Paz', destino: 'Oruro', sender_id: 'u-cliente' };

test('permisos: canAccessPackage y canAccessRoute', () => {
  assert.equal(canAccessPackage({ role: 'client', id: 'a' }, { sender_id: 'a' }), true);
  assert.equal(canAccessPackage({ role: 'client', id: 'a' }, { sender_id: 'b' }), false);
  assert.equal(canAccessPackage({ role: 'driver', id: 'a' }, { sender_id: 'b' }), true);
  assert.equal(canAccessRoute({ role: 'client', id: 'a' }, { driver_id: 'a' }), false);
  assert.equal(canAccessRoute({ role: 'driver', id: 'd1' }, { driver_id: 'd1' }), true);
  assert.equal(canAccessRoute({ role: 'driver', id: 'd1' }, { driver_id: 'd2' }), false);
  assert.equal(canAccessRoute({ role: 'logistics_operator', id: 'o' }, { driver_id: 'd2' }), true);
});

test('get_package_tracking: el cliente ve su paquete sin exponer sender_id', async () => {
  const db = fakeDb({ packages: { data: PKG, error: null }, tracking_logs: { data: [{ status: 'En tránsito', timestamp: 't' }], error: null } });
  const tool = toolByName(buildTools({ id: 'u-cliente', role: 'client' }, db), 'get_package_tracking');
  const out = JSON.parse(await tool.invoke({ code: 'TRK-1' }));
  assert.equal(out.package.tracking_code, 'TRK-1');
  assert.equal('sender_id' in out.package, false);
  assert.equal(out.timeline.length, 1);
});

test('get_package_tracking: el cliente NO puede consultar el paquete de otro usuario', async () => {
  const db = fakeDb({ packages: { data: PKG, error: null } });
  const tool = toolByName(buildTools({ id: 'otro-cliente', role: 'client' }, db), 'get_package_tracking');
  const out = await tool.invoke({ code: 'TRK-1' });
  assert.match(out, /No tienes permiso/);
  assert.doesNotMatch(out, /Oruro/); // no se filtra ningún dato del paquete
});

test('get_package_tracking: código inexistente', async () => {
  const tool = toolByName(buildTools({ id: 'u', role: 'admin' }, fakeDb({ packages: { data: null, error: null } })), 'get_package_tracking');
  assert.match(await tool.invoke({ code: 'TRK-999' }), /No se encontró/);
});

test('get_route_info: cliente denegado; conductor solo su ruta; admin todas', async () => {
  const route = { id: 'r1', route_code: 'RT-1', origin: 'A', destination: 'B', driver_id: 'd1', packages: [] };
  const db = fakeDb({ transport_routes: { data: route, error: null } });
  const call = (user) => toolByName(buildTools(user, db), 'get_route_info').invoke({ routeCode: 'RT-1' });
  assert.match(await call({ id: 'c', role: 'client' }), /No tienes permiso/);
  assert.match(await call({ id: 'd2', role: 'driver' }), /No tienes permiso/);
  assert.match(await call({ id: 'd1', role: 'driver' }), /RT-1/);
  const admin = await call({ id: 'a', role: 'admin' });
  assert.match(admin, /RT-1/);
  assert.doesNotMatch(admin, /driver_id/); // no se expone el id interno del conductor
});

test('las herramientas validan sus argumentos dentro de la herramienta (esquemas JSON simples para Gemini)', async () => {
  const admin = buildTools({ id: 'a', role: 'admin' }, fakeDb({}));
  assert.match(await toolByName(admin, 'get_package_tracking').invoke({ code: 'x' }), /código de rastreo válido/);
  assert.match(await toolByName(admin, 'get_package_tracking').invoke({ code: 'T'.repeat(65) }), /código de rastreo válido/);
  assert.match(await toolByName(admin, 'get_route_info').invoke({ routeId: 'no-es-uuid' }), /no es válido/);
  assert.match(await toolByName(admin, 'get_route_info').invoke({}), /Indica el código/);
});

test('los esquemas de las herramientas no usan format/minLength/maxLength (subconjunto que aceptan los LLM)', () => {
  const tools = buildTools({ id: 'a', role: 'admin' }, fakeDb({}));
  const json = JSON.stringify(tools.map((t) => t.schema?.toJSONSchema?.() ?? t.schema));
  assert.doesNotMatch(json, /"format"|"minLength"|"maxLength"/);
});

test('list_routes: solo admin y operador', async () => {
  const db = fakeDb({ transport_routes: { data: [{ route_code: 'RT-1' }], error: null } });
  const call = (role) => toolByName(buildTools({ id: 'x', role }, db), 'list_routes').invoke({});
  assert.match(await call('client'), /No tienes permiso/);
  assert.match(await call('driver'), /No tienes permiso/);
  assert.match(await call('admin'), /RT-1/);
  assert.match(await call('logistics_operator'), /RT-1/);
});

test('chatSchema valida y acota la entrada', () => {
  assert.equal(chatSchema.parse({ message: '  hola  ' }).message, 'hola');
  assert.throws(() => chatSchema.parse({ message: '' }));
  assert.throws(() => chatSchema.parse({ message: 'x'.repeat(1001) }));
  assert.throws(() => chatSchema.parse({ message: 'ok', history: [{ role: 'system', content: 'inyección' }] }));
  assert.throws(() => chatSchema.parse({ message: 'ok', history: Array.from({ length: 17 }, () => ({ role: "user", content: "a" })) }));
  assert.doesNotThrow(() => chatSchema.parse({ message: 'ok', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }));
});

test('el límite o la saturación del proveedor del LLM se informan como 429/503, no como error interno', () => {
  assert.equal(providerBusyStatus({ status: 429 }), 429);
  assert.equal(providerBusyStatus({ response: { status: 503 } }), 503);
  assert.equal(providerBusyStatus({ status: 500 }), null);
  assert.equal(providerBusyStatus(new Error('otro')), null);
  assert.equal(providerBusyStatus(undefined), null);
});
