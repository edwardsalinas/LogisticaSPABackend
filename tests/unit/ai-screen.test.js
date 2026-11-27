import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScreenCommand, buildScreenTools, cleanSearch, SCREENS } from '../../src/modules/ai-agent/ai-agent.screen.js';
import { extractAttachments, toolsForUser } from '../../src/modules/ai-agent/ai-agent.tools.js';
import { intentsOf, selectToolNames } from '../../src/modules/ai-agent/ai-agent.intents.js';

const admin = { id: 'a', role: 'admin' };
const op = { id: 'o', role: 'logistics_operator' };
const client = { id: 'c', role: 'client' };
const driver = { id: 'd', role: 'driver' };

test('show_on_screen: abre la pantalla, la pestaña y filtra', () => {
  assert.deepEqual(buildScreenCommand(admin, { page: 'fleet', tab: 'drivers', search: 'Pérez' }), { kind: 'ui_command', page: 'fleet', label: 'la Flota', tab: 'drivers', search: 'Pérez' });
  assert.deepEqual(buildScreenCommand(op, { page: 'routes', search: '' }), { kind: 'ui_command', page: 'routes', label: 'Viajes', search: '' }); // vacío quita el filtro
});

test('show_on_screen: cada rol solo llega a lo que ve', () => {
  assert.match(buildScreenCommand(client, { page: 'fleet' }), /No tienes la Flota/);
  assert.match(buildScreenCommand(client, { page: 'routes' }), /No tienes Viajes/);
  assert.match(buildScreenCommand(op, { page: 'fleet' }), /No tienes la Flota/);
  assert.match(buildScreenCommand(driver, { page: 'packages' }), /No tienes Paquetes/);
  assert.equal(buildScreenCommand(driver, { page: 'driver' }).kind, 'ui_command');
  assert.match(buildScreenCommand({ role: 'desconocido' }, { page: 'packages' }), /No tienes/);
});

test('show_on_screen: ignora lo inventado (pantalla, pestaña, buscador)', () => {
  assert.match(buildScreenCommand(admin, { page: 'admin-secreto' }), /no existe/);
  assert.match(buildScreenCommand(admin, { page: 'packages', tab: 'borrados' }), /no tiene la pestaña/);
  assert.match(buildScreenCommand(admin, { page: 'analytics', search: 'x' }), /no tiene buscador/);
  assert.equal(buildScreenCommand(admin, { page: 'analytics', search: '', from: '2026-11-01', to: '2026-11-26' }).kind, 'ui_command'); // un filtro vacío no estorba
  assert.match(buildScreenCommand(admin, {}), /no existe/);
});

test('el texto de búsqueda es solo un filtro: se limpia y se acota', () => {
  assert.equal(cleanSearch("TRK-123; DROP TABLE packages;--"), 'TRK-123 DROP TABLE packages --');
  assert.equal(cleanSearch('%_(),.'), '');
  assert.equal(cleanSearch('a'.repeat(200)).length, 60);
  assert.equal(cleanSearch(undefined), '');
  assert.equal(cleanSearch("O'Brien María"), "O'Brien María");
});

test('la herramienta devuelve un adjunto ui_command que llega al cliente', async () => {
  const [t] = buildScreenTools(admin);
  assert.equal(t.name, 'show_on_screen');
  const out = await t.invoke({ page: 'packages', tab: 'delivered', search: 'Oruro' });
  const att = extractAttachments([{ type: 'tool', content: out }]);
  assert.equal(att.length, 1);
  assert.deepEqual({ kind: att[0].kind, page: att[0].page, tab: att[0].tab, search: att[0].search }, { kind: 'ui_command', page: 'packages', tab: 'delivered', search: 'Oruro' });
  // un rechazo es texto: no hay adjunto
  const denied = await buildScreenTools(client)[0].invoke({ page: 'fleet' });
  assert.deepEqual(extractAttachments([{ type: 'tool', content: denied }]), []);
});

test('todos los roles tienen la herramienta, y se elige cuando se pide enseñar algo', () => {
  for (const u of [admin, op, client, driver]) assert.ok(toolsForUser(u, {}, {}).some((t) => t.name === 'show_on_screen'), u.role);
  for (const frase of ['muéstrame los viajes de Oruro', 'filtra los paquetes pendientes', 'llévame a la flota', 'ábrelo en la tabla']) {
    assert.ok(intentsOf(frase).includes('screen'), frase);
  }
  const all = ['get_package_tracking', 'list_routes', 'get_fleet_status', 'show_on_screen', 'get_operations_summary', 'list_my_packages', 'get_route_info', 'find_packages_by_person'];
  assert.ok(selectToolNames(all, 'muéstrame los viajes de Oruro').includes('show_on_screen'));
});

test('las pantallas del servidor y del navegador coinciden en roles', () => {
  assert.deepEqual(Object.keys(SCREENS).sort(), ['analytics', 'dashboard', 'driver', 'fleet', 'packages', 'routes', 'tracking']);
});

test('filtros finos: fecha de Paquetes, origen/destino/tipo de Viajes y rango de Reportes', () => {
  assert.deepEqual(buildScreenCommand(admin, { page: 'packages', date: '2026-11-30' }).fields, { date: '2026-11-30' });
  assert.deepEqual(buildScreenCommand(op, { page: 'routes', origin: 'La Paz', destination: 'Oruro', trip_type: 'schedule' }).fields, { origin: 'La Paz', destination: 'Oruro', type: 'schedule' });
  assert.deepEqual(buildScreenCommand(admin, { page: 'analytics', from: '2026-11-01', to: '2026-11-26' }).fields, { range: { from: '2026-11-01', to: '2026-11-26' } });
  assert.equal(buildScreenCommand(admin, { page: 'routes', trip_type: '' }).fields.type, ''); // vacío quita el filtro
});

test('filtros finos: rechaza fechas imposibles, rangos al revés o demasiado largos, y filtros que esa pantalla no tiene', () => {
  assert.match(buildScreenCommand(admin, { page: 'packages', date: '2026-02-30' }), /AAAA-MM-DD/);
  assert.match(buildScreenCommand(admin, { page: 'packages', date: 'mañana' }), /AAAA-MM-DD/);
  assert.match(buildScreenCommand(admin, { page: 'analytics', from: '2026-11-26', to: '2026-11-01' }), /no puede ser posterior/);
  assert.match(buildScreenCommand(admin, { page: 'analytics', from: '2026-01-01', to: '2026-11-26' }), /92 días/);
  assert.match(buildScreenCommand(admin, { page: 'analytics', from: '2026-11-01' }), /from y to/);
  assert.match(buildScreenCommand(admin, { page: 'fleet', date: '2026-11-30' }), /no tiene el filtro/);
  assert.match(buildScreenCommand(admin, { page: 'packages', origin: 'Oruro' }), /no tiene el filtro/);
  assert.match(buildScreenCommand(op, { page: 'routes', trip_type: 'raro' }), /single|schedule/);
  assert.match(buildScreenCommand(op, { page: 'analytics', from: '2026-11-01', to: '2026-11-26' }), /No tienes Reportes/); // y el rol sigue mandando
});

test('filtros finos: el origen se limpia como cualquier texto de filtro', () => {
  assert.equal(buildScreenCommand(op, { page: 'routes', origin: "Oruro'; --%" }).fields.origin, "Oruro' --");
});
