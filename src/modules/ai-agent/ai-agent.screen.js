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
  packages: { label: 'Paquetes', roles: [...STAFF, 'client'], tabs: ['all', 'list', 'delivered'], search: true, fields: ['date'] },
  routes: { label: 'Viajes', roles: STAFF, tabs: ['calendar', 'list'], search: true, fields: ['origin', 'destination', 'type'] },
  tracking: { label: 'Seguimiento', roles: [...STAFF, 'client'], search: true },
  fleet: { label: 'la Flota', roles: ['admin'], tabs: ['vehicles', 'drivers'], search: true },
  analytics: { label: 'Reportes', roles: ['admin'], fields: ['range'] },
  driver: { label: 'tu viaje', roles: ['driver'] },
};
export const SCREEN_NAMES = Object.keys(SCREENS);
const MAX_SEARCH = 60;
const MAX_RANGE_DAYS = 92; // el mismo límite que la analítica
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (s) => YMD.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const FIELD_HELP = { date: 'date', range: 'from y to', origin: 'origin', destination: 'destination', type: 'trip_type' };

export const cleanSearch = (text) =>
  String(text ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);

/** Pura y probable: devuelve el adjunto o un texto de error para el modelo. */
export const buildScreenCommand = (user, { page, tab, search, date, from, to, origin, destination, trip_type: tripType } = {}) => {
  const screen = Object.hasOwn(SCREENS, String(page)) ? SCREENS[page] : null; // nunca nombres heredados («constructor»)
  if (!screen) return `Esa pantalla no existe. Las pantallas son: ${SCREEN_NAMES.join(', ')}.`;
  if (!screen.roles.includes(user?.role)) return `No tienes ${screen.label} disponible con tu rol; no puedo mostrártela.`;
  const cmd = { kind: 'ui_command', page, label: screen.label };
  if (tab) {
    if (!screen.tabs?.includes(tab)) return `${screen.label} no tiene la pestaña «${tab}». Las que tiene: ${(screen.tabs ?? []).join(', ') || 'ninguna'}.`;
    cmd.tab = tab;
  }
  if (search !== undefined && search !== null) {
    const text = cleanSearch(search);
    if (screen.search) cmd.search = text;
    else if (text) return `${screen.label} no tiene buscador.`; // un texto vacío («sin filtro») en una pantalla sin buscador no pide nada
  }
  // filtros finos: solo los que esa pantalla sabe poner, y con valores de forma válida
  const fields = {};
  const ask = (field, value) => {
    if (!screen.fields?.includes(field)) return `${screen.label} no tiene el filtro «${FIELD_HELP[field]}».`;
    fields[field] = value;
    return null;
  };
  let err = null;
  if (date !== undefined && date !== null) err = validYmd(date) ? ask('date', date) : 'La fecha debe tener la forma AAAA-MM-DD.';
  if (!err && (from || to)) {
    if (!validYmd(from) || !validYmd(to)) err = 'El rango necesita from y to con la forma AAAA-MM-DD.';
    else if (from > to) err = 'La fecha inicial no puede ser posterior a la final.';
    else if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS) err = `El rango no puede pasar de ${MAX_RANGE_DAYS} días.`;
    else err = ask('range', { from, to });
  }
  if (!err && origin !== undefined && origin !== null) err = ask('origin', cleanSearch(origin));
  if (!err && destination !== undefined && destination !== null) err = ask('destination', cleanSearch(destination));
  if (!err && tripType !== undefined && tripType !== null) {
    const t = tripType === 'schedule' || tripType === 'single' || tripType === '' ? tripType : null;
    err = t === null ? 'trip_type debe ser single (viajes sueltos), schedule (programados) o vacío.' : ask('type', t);
  }
  if (err) return err;
  if (Object.keys(fields).length) cmd.fields = fields;
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
        'Deja a la vista del usuario una pantalla: la abre, cambia de pestaña y/o filtra su tabla. Úsala cuando pida "muéstrame", "llévame", "filtra", "busca en la tabla", y también tras crear o consultar algo para enseñárselo. Solo mueve la pantalla: no cambia datos. Pantallas: dashboard, packages (pestañas all=operativos, list=todos los paquetes, delivered=histórico), routes (calendar|list), tracking, fleet (vehicles|drivers), analytics, driver. `search` es el texto con el que se filtra la tabla (un código TRK-…, una ciudad, un nombre); vacío quita el filtro. Filtros finos: packages `date` (el día del tablero); routes `origin`, `destination` y `trip_type`; analytics `from` y `to` (rango de fechas, máximo 92 días). Usa las fechas exactas del calendario, nunca las calcules.',
      schema: z.object({
        page: z.string().describe('Pantalla: dashboard, packages, routes, tracking, fleet, analytics o driver'),
        tab: z.string().optional().describe('Pestaña de esa pantalla, si la tiene'),
        search: z.string().optional().describe('Texto para filtrar la tabla; cadena vacía para quitar el filtro'),
        date: z.string().optional().describe('packages: día del tablero de despachos, AAAA-MM-DD'),
        from: z.string().optional().describe('analytics: inicio del rango, AAAA-MM-DD (máximo 92 días con to)'),
        to: z.string().optional().describe('analytics: fin del rango, AAAA-MM-DD'),
        origin: z.string().optional().describe('routes: ciudad de origen para filtrar; vacío quita el filtro'),
        destination: z.string().optional().describe('routes: ciudad de destino para filtrar; vacío quita el filtro'),
        trip_type: z.string().optional().describe('routes: single (viajes sueltos), schedule (programados) o vacío para todos'),
      }),
    }
  ),
];
