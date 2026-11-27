/**
 * Selección de herramientas según lo que pregunta el usuario.
 *
 * Cada llamada al modelo reenvía las definiciones de TODAS las herramientas del rol (hasta ~3 400 tokens para un
 * administrador), aunque la pregunta solo necesite una o dos. Aquí se deducen las "intenciones" de la pregunta y solo
 * se envían las herramientas de esos grupos: menos tokens, respuestas más rápidas y más preguntas por minuto dentro
 * de los límites gratuitos.
 *
 * Es una red de seguridad conservadora: si no se reconoce ninguna intención (o el rol tiene pocas herramientas),
 * se envían todas, así una pregunta rara nunca se queda sin las herramientas que necesita.
 */
const GROUPS = {
  lookup: {
    tools: ['get_package_tracking', 'find_packages_by_person', 'list_my_packages'],
    re: /\b(paquete|paquetes|trk|caja|cajas|encomienda|envio|envios|guia|rastre\w*|ubica\w*|donde esta|estado de|a nombre|destinatari\w*|remitente|quien lo lleva|cuando llega)\b/,
  },
  ops: {
    tools: ['get_operations_summary', 'list_packages_needing_attention', 'get_daily_briefing'],
    re: /\b(operacion|resumen|atender|atencion|retras\w*|siniestro\w*|problema\w*|pendiente\w*|prioridad\w*|por donde empiezo|como va|que hay hoy|novedad\w*|alerta\w*)\b/,
  },
  fleet: {
    tools: ['get_fleet_status', 'check_fleet_availability'],
    re: /\b(flota|vehiculo\w*|camion\w*|conductor\w*|chofer\w*|disponib\w*|libre\w*|unidad\w*|furgon\w*)\b/,
  },
  trips: {
    tools: ['list_routes', 'get_route_info', 'find_available_trips'],
    re: /\b(ruta\w*|viaje\w*|tramo\w*|espacio|cupo|salida\w*|transito|lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy|semana|tarde|noche|hora\w*|cuanto espacio|agendar|programad\w*)\b/,
  },
  analytics: {
    tools: ['get_analytics_summary'],
    re: /\b(mes|meses|semana pasada|ultimo mes|analitic\w*|ranking|rendimiento|estadistic\w*|metrica\w*|tendencia\w*|balance|quien entrega|a tiempo|kpi)\b/,
  },
  suggest: {
    tools: ['suggest_assignments', 'propose_assign_package'],
    re: /\b(suelt\w+|sin asignar|sin viaje|sin ruta|sugier\w+|sugerenc\w+|recomiend\w+|optimiz\w+|reparto|repartir|que puedo asignar|asignaciones)\b/,
  },
  screen: {
    tools: ['show_on_screen'],
    re: /\b(muestra\w*|muestrame|llevame|llevarme|ensena\w*|filtra\w*|busca\w*|abre|abrir|ver en|pantalla|tabla|pestana|historico|vamos a|ve a)\b/,
  },
  actions: {
    tools: ['propose_register_event', 'propose_deliver_package', 'propose_create_package', 'propose_assign_package', 'propose_cancel_package', 'propose_assign_driver', 'propose_create_trip'],
    re: /\b(registra\w*|crea\w*|nuevo paquete|entrega\w*|entregar|marca\w*|asigna\w*|evento|agrega\w*|anota\w*|confirma\w*|cancela\w*|anula\w*|despacha\w*|cargar|carga|conductor\w*|chofer\w*|programa\w*|cambia\w*)\b/,
  },
};

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Por debajo de este número de herramientas el ahorro no compensa el riesgo de dejar una fuera
const MIN_TOOLS_TO_FILTER = 7;

/** Grupos de herramientas que sugiere un texto. */
export const intentsOf = (text) => {
  const t = normalize(text);
  const found = Object.entries(GROUPS).filter(([, g]) => g.re.test(t)).map(([name]) => name);
  if (/\btrk-/i.test(text)) found.push('lookup');
  return [...new Set(found)];
};

/**
 * @param {string[]} allowed nombres de las herramientas que el rol puede usar
 * @param {string} message mensaje actual
 * @param {{role: string, content: string}[]} history conversación previa (los seguimientos "¿y quién lo lleva?" heredan el tema)
 * @returns {string[]} subconjunto de `allowed`
 */
export const selectToolNames = (allowed, message, history = []) => {
  if (allowed.length < MIN_TOOLS_TO_FILTER) return allowed;

  let intents = intentsOf(message);
  // Un mensaje corto sin tema propio ("¿y quién lo lleva?", "sí, hazlo") continúa el anterior
  const lastUserMessages = history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content);
  if (intents.length === 0 || normalize(message).length < 24) {
    intents = [...new Set([...intents, ...lastUserMessages.flatMap(intentsOf)])];
    // confirmar o precisar algo tras una propuesta o una respuesta necesita las acciones y la búsqueda
    if (history.length && /\b(si|ok|dale|hazlo|confirma\w*|ese|esa|el primero|el segundo)\b/.test(normalize(message))) intents.push('actions', 'lookup');
  }
  if (intents.length === 0) return allowed; // sin pistas: todas

  const wanted = new Set(intents.flatMap((i) => GROUPS[i].tools));
  const subset = allowed.filter((name) => wanted.has(name));
  return subset.length ? subset : allowed;
};

// ============================================================ atajo: preguntas inequívocas sin la llamada de "decidir"
/**
 * Un agente normal hace dos llamadas al modelo: la primera solo para decidir qué herramienta usar, la segunda para
 * redactar la respuesta. Cuando la pregunta es inequívoca (un código de paquete, "resumen del día", "mis paquetes")
 * la herramienta se puede ejecutar directamente y basta UNA llamada al modelo para redactar: la mitad de tokens y
 * el primer texto llega mucho antes. Es deliberadamente conservador: ante cualquier duda (varios temas, una acción,
 * un seguimiento sin código) devuelve null y se usa el agente completo.
 *
 * @returns {{ tool: string, args: object } | null}
 */
export const fastPlanFor = (allowed, message) => {
  const text = String(message ?? '');
  if (text.length > 220) return null;
  const t = normalize(text);
  const intents = intentsOf(text);
  const has = (name) => allowed.includes(name);
  const without = (...bad) => !bad.some((b) => intents.includes(b));

  // 1) Un código de rastreo: ubicar ese paquete
  const code = text.match(/\bTRK-[A-Za-z0-9-]{3,}\b/i)?.[0];
  if (code && has('get_package_tracking') && without('actions', 'fleet', 'analytics', 'ops')) {
    return { tool: 'get_package_tracking', args: { code: code.toUpperCase() } };
  }

  // 2) "Cómo va el día / la operación" (personal)
  if (has('get_daily_briefing') && !code && without('actions', 'lookup', 'fleet', 'analytics')
      && /\b(resumen del dia|como va (la operacion|el dia|hoy)|por donde empiezo|que (tengo que )?atender|que hay para hoy)\b/.test(t)) {
    return { tool: 'get_daily_briefing', args: {} };
  }

  // 3) "Sugiere asignaciones / paquetes sueltos" (personal)
  // ("asignaciones" o "asignar" no son una orden; "asigna", "registra", "entrega"... sí, y entonces va el agente completo)
  if (has('suggest_assignments') && !code && without('fleet', 'analytics') && !/(asigna|registra|crea|entrega|marca|agrega|anota|confirma|cancela|despacha)/.test(t)
      && /\b(paquetes suelt\w+|carga suelta|sugier\w+ (como )?(las )?asignacion\w*|sugerenc\w+ de asignacion\w*|(que|cuales) paquetes (puedo|debo) asignar|como (reparto|asigno) (los )?paquetes)\b/.test(t)) {
    return { tool: 'suggest_assignments', args: {} };
  }

  // 4) "¿Qué paquetes tengo?" sin más
  if (has('list_my_packages') && !code && without('actions', 'ops', 'fleet', 'analytics', 'trips')
      && /\b(que paquetes tengo|mis paquetes|cuales son mis paquetes|que envios tengo|mis envios)\b/.test(t)) {
    return { tool: 'list_my_packages', args: {} };
  }
  return null;
};
