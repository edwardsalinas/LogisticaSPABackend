/**
 * Caché corta de las herramientas de SOLO LECTURA del agente.
 *
 * Las consultas de resumen (operación del día, flota, analítica, rutas) se repiten mucho y cada una espera a la
 * base de datos (0,5 a 2 s). Con una caché de unos segundos la segunda pregunta parecida es inmediata. Los datos
 * que dependen de la persona (su agenda, sus paquetes) se separan por usuario; las acciones confirmadas vacían la
 * caché para que nadie vea cifras viejas justo después de cambiar algo.
 */
export const TOOL_CACHE_TTL_MS = 45 * 1000;

// herramienta -> ¿depende del usuario concreto? (si no, se comparte entre usuarios del mismo rol)
const CACHEABLE = {
  get_operations_summary: false,
  get_fleet_status: false,
  get_analytics_summary: false,
  list_routes: false,
  list_packages_needing_attention: false,
  get_daily_briefing: true,
  get_my_deliveries: true,
  find_available_trips: true,
  check_fleet_availability: true,
};

const store = new Map(); // clave -> { value, expiresAt }
const MAX_ENTRIES = 200;

export const clearToolCache = () => store.clear();
export const toolCacheSize = () => store.size;

const keyOf = (name, user, args) =>
  [name, user?.role ?? '', CACHEABLE[name] ? user?.id ?? '' : '', JSON.stringify(args ?? {})].join('|');

/**
 * Envuelve las herramientas cacheables de la lista (modifica `func` en cada herramienta, que se crea por petición).
 * Solo se guardan las respuestas correctas: un error ("No se pudo…") nunca se queda en la caché.
 */
export const withToolCache = (tools, user, { now = Date.now, ttlMs = TOOL_CACHE_TTL_MS } = {}) => {
  for (const t of tools) {
    if (!(t.name in CACHEABLE) || typeof t.func !== 'function') continue;
    const original = t.func;
    t.func = async (args, ...rest) => {
      const key = keyOf(t.name, user, args);
      const hit = store.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      const value = await original.call(t, args, ...rest);
      const ok = typeof value === 'string' && !/^No se pudo|^Indica |^No tienes permiso/.test(value);
      if (ok) {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
        store.set(key, { value, expiresAt: now() + ttlMs });
      }
      return value;
    };
  }
  return tools;
};
