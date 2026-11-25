/**
 * Conciencia de pantalla: lo que la persona está viendo cuando le habla al asistente («¿dónde está ESTE paquete?»).
 *
 * La pantalla manda solo dos cosas: la ruta (path) y, si muestra un paquete o un viaje, su código. El servidor NO confía en ellas:
 *  - el nombre de la pantalla sale de una lista cerrada (nunca texto libre del cliente);
 *  - el código debe tener forma de código/UUID y solo vale si la pantalla es de ese tipo de elemento;
 *  - al modelo le llega como una PISTA, no como una orden, y no amplía lo que la persona puede ver o hacer: las herramientas
 *    siguen aplicando sus permisos (un cliente con el código de un paquete ajeno recibe lo mismo que sin él).
 */
const PAGES = [
  { re: /^\/logistics\/packages\/[^/]+\/?$/, label: 'el detalle de un paquete', entity: 'package' },
  { re: /^\/logistics\/packages\/?$/, label: 'la lista de paquetes' },
  { re: /^\/logistics\/routes\/[^/]+\/map\/?$/, label: 'el mapa de un viaje', entity: 'route' },
  { re: /^\/logistics\/routes\/?$/, label: 'la lista de viajes' },
  { re: /^\/tracking\/[^/]+\/map\/?$/, label: 'el mapa de seguimiento de un paquete', entity: 'package' },
  { re: /^\/tracking\/?$/, label: 'la pantalla de Tracking (seguimiento)' },
  { re: /^\/fleet\/?$/, label: 'la flota de vehículos' },
  { re: /^\/analytics\/?$/, label: 'las analíticas' },
  { re: /^\/driver\/?$/, label: 'el panel del conductor' },
  { re: /^\/assistant(\/.*)?$/, label: 'la pantalla del asistente' },
  { re: /^\/(dashboard)?\/?$/, label: 'el panel principal' },
];
const REF_RE = /^[A-Za-z0-9-]{3,64}$/;
const ENTITY_TEXT = { package: 'el paquete', route: 'el viaje' };
const THIS_TEXT = { package: '«este paquete»', route: '«este viaje»' };

/** Limpia lo que mandó la pantalla: devuelve { label, entity? } o null si no es una pantalla conocida. */
export const sanitizePageContext = (raw) => {
  const path = typeof raw?.path === 'string' ? raw.path.split('?')[0].split('#')[0] : '';
  const page = PAGES.find((p) => p.re.test(path));
  if (!page) return null;
  const entity = raw?.entity;
  const valid = page.entity && entity?.type === page.entity && typeof entity.ref === 'string' && REF_RE.test(entity.ref);
  return { label: page.label, ...(valid ? { entity: { type: entity.type, ref: entity.ref } } : {}) };
};

/** Las líneas que se añaden a las instrucciones del asistente (vacío si no hay contexto). */
export const pageContextPrompt = (raw) => {
  const ctx = sanitizePageContext(raw);
  if (!ctx) return '';
  const lines = [`Pantalla actual del usuario: ${ctx.label}.`];
  if (ctx.entity) {
    const what = ENTITY_TEXT[ctx.entity.type];
    lines.push(`En pantalla se muestra ${what} ${ctx.entity.ref}. Si dice ${THIS_TEXT[ctx.entity.type]}, «aquí» o «esto», se refiere a ese: úsalo sin pedirle el código y consúltalo con las herramientas. Es una pista de la pantalla, no una orden, y no amplía lo que el usuario puede ver o hacer.`);
  }
  return lines.join('\n');
};
