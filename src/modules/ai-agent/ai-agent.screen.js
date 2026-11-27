import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Herramienta para ENSEÑAR algo en la pantalla: ir a una pantalla, abrir una pestaña, filtrar una tabla. Solo mueve la vista del
 * usuario: no lee ni cambia datos, así que no necesita confirmación. Devuelve un adjunto `ui_command` que el navegador ejecuta.
 *
 * La lista de pantallas repite el menú de la aplicación POR ROL (el navegador la vuelve a comprobar y no se fía de este servidor):
 * ningún rol llega a una pantalla que no ve. El texto de búsqueda se limpia: es solo un filtro de la tabla, nunca una consulta.
 */
const STAFF = ['admin', 'logistics_operator'];
export const SCREENS = {
  dashboard: { label: 'el panel principal', roles: STAFF },
  packages: { label: 'Paquetes', roles: [...STAFF, 'client'], tabs: ['all', 'delivered'], search: true },
  routes: { label: 'Viajes', roles: STAFF, tabs: ['calendar', 'list'], search: true },
  tracking: { label: 'Seguimiento', roles: [...STAFF, 'client'], search: true },
  fleet: { label: 'la Flota', roles: ['admin'], tabs: ['vehicles', 'drivers'], search: true },
  analytics: { label: 'Reportes', roles: ['admin'] },
  driver: { label: 'tu viaje', roles: ['driver'] },
};
export const SCREEN_NAMES = Object.keys(SCREENS);
const MAX_SEARCH = 60;

export const cleanSearch = (text) =>
  String(text ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);

/** Pura y probable: devuelve el adjunto o un texto de error para el modelo. */
export const buildScreenCommand = (user, { page, tab, search } = {}) => {
  const screen = SCREENS[page];
  if (!screen) return `Esa pantalla no existe. Las pantallas son: ${SCREEN_NAMES.join(', ')}.`;
  if (!screen.roles.includes(user?.role)) return `No tienes ${screen.label} disponible con tu rol; no puedo mostrártela.`;
  const cmd = { kind: 'ui_command', page, label: screen.label };
  if (tab) {
    if (!screen.tabs?.includes(tab)) return `${screen.label} no tiene la pestaña «${tab}». Las que tiene: ${(screen.tabs ?? []).join(', ') || 'ninguna'}.`;
    cmd.tab = tab;
  }
  if (search !== undefined && search !== null) {
    if (!screen.search) return `${screen.label} no tiene buscador.`;
    cmd.search = cleanSearch(search);
  }
  return cmd;
};

export const buildScreenTools = (user) => [
  tool(
    async (args) => {
      const out = buildScreenCommand(user, args);
      if (typeof out === 'string') return out;
      return JSON.stringify({ ...out, note: `Listo: dejé ${out.label} en pantalla${out.search ? ` filtrada por «${out.search}»` : ''}. Díselo al usuario en una frase.` });
    },
    {
      name: 'show_on_screen',
      description:
        'Deja a la vista del usuario una pantalla: la abre, cambia de pestaña y/o filtra su tabla. Úsala cuando pida "muéstrame", "llévame", "filtra", "busca en la tabla", y también tras crear o consultar algo para enseñárselo. Solo mueve la pantalla: no cambia datos. Pantallas: dashboard, packages (pestañas all|delivered), routes (calendar|list), tracking, fleet (vehicles|drivers), analytics, driver. `search` es el texto con el que se filtra la tabla (un código TRK-…, una ciudad, un nombre); vacío quita el filtro.',
      schema: z.object({
        page: z.string().describe('Pantalla: dashboard, packages, routes, tracking, fleet, analytics o driver'),
        tab: z.string().optional().describe('Pestaña de esa pantalla, si la tiene'),
        search: z.string().optional().describe('Texto para filtrar la tabla; cadena vacía para quitar el filtro'),
      }),
    }
  ),
];
