import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createProposal } from './ai-actions.service.js';
import { PACKAGE_STATUS, packageSchema } from '../logistics/logistics.schema.js';

/**
 * Herramientas que PROPONEN acciones. Ninguna modifica datos: validan permisos, estado y datos, y devuelven una
 * propuesta (id + resumen redactado aquí, no por el modelo) que el usuario debe confirmar en pantalla.
 * Pueden proponer varios paquetes de una vez (hasta MAX_BATCH) con UNA sola confirmación; lo que no se puede hacer
 * se omite y se dice por qué, para que el usuario decida con la información completa.
 */
const OPS = ['admin', 'logistics_operator'];
const FINAL = [PACKAGE_STATUS.DELIVERED, PACKAGE_STATUS.RETURNED, PACKAGE_STATUS.CANCELLED];
const ASSIGNABLE = [PACKAGE_STATUS.PENDING, PACKAGE_STATUS.ASSIGNED];
export const MAX_BATCH = 10;
const EVENT_STATUS = { en_transito: 'En tránsito', en_agencia: 'En agencia', siniestro: 'Siniestro' };
const STATUS_TEXT = {
  pendiente: 'Pendiente', asignado: 'Asignado', en_transito: 'En tránsito', en_agencia: 'En agencia',
  entregado: 'Entregado', siniestro: 'Siniestro', devuelto: 'Devuelto', cancelado: 'Cancelado',
};
const DENIED = 'No tienes permiso para realizar esa acción.';
const MAX_NOTE = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const asText = (value) => JSON.stringify(value);
const proposalResult = (proposal, skipped = []) => asText({
  kind: 'action_proposal',
  action: proposal,
  skipped, // lo que se pidió pero no se pudo incluir, con el motivo (para decírselo al usuario)
  instruction: 'La acción NO se ha ejecutado. Dile al usuario que revise la tarjeta y pulse Confirmar; no afirmes que ya está hecha.' +
    (skipped.length ? ' Menciona también lo que se omitió y por qué.' : ''),
});

const cleanNote = (note) => {
  const n = typeof note === 'string' ? note.trim() : '';
  return n.length > MAX_NOTE ? null : n;
};

/** Une `code` y `codes`, sin repetidos ni vacíos. Devuelve { codes } o { error }. */
export const normalizeCodes = ({ code, codes }) => {
  const all = [...(Array.isArray(codes) ? codes : []), ...(code ? [code] : [])]
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  const unique = [...new Set(all)];
  if (unique.length === 0) return { error: 'Indica un código de rastreo válido (empieza con TRK-).' };
  if (unique.length > MAX_BATCH) return { error: `Son demasiados paquetes de una vez (máximo ${MAX_BATCH}). Divídelos en grupos.` };
  if (unique.some((c) => c.length < 3 || c.length > 64)) return { error: 'Indica un código de rastreo válido (empieza con TRK-).' };
  return { codes: unique };
};

const findPackage = async (db, code) => {
  const { data, error } = await db
    .from('packages')
    .select('id, tracking_code, status, origen, destino, peso, route_id')
    .eq('tracking_code', code)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
};

/** Última posición conocida; si no hay, el origen de su ruta; si tampoco, la ciudad de origen. */
const locateForEvent = async (db, pkg) => {
  const { data: logs } = await db.from('tracking_logs').select('lat, lng').eq('package_id', pkg.id).order('timestamp', { ascending: false }).limit(5);
  const last = (logs || []).find((l) => isNum(l.lat) && isNum(l.lng) && !(l.lat === 0 && l.lng === 0));
  if (last) return { lat: last.lat, lng: last.lng, text: 'la última posición conocida del paquete' };

  if (pkg.route_id) {
    const { data: route } = await db.from('transport_routes').select('origin_lat, origin_lng').eq('id', pkg.route_id).maybeSingle();
    if (route && isNum(route.origin_lat) && isNum(route.origin_lng)) return { lat: route.origin_lat, lng: route.origin_lng, text: 'el punto de origen de su ruta' };
  }
  const cityText = `la ciudad de origen (${pkg.origen}), porque el paquete aún no tiene posición GPS`;
  const { data: asOrigin } = await db.from('predefined_routes').select('origin_lat, origin_lng').eq('origin_city', pkg.origen).limit(1).maybeSingle();
  if (asOrigin && isNum(asOrigin.origin_lat) && isNum(asOrigin.origin_lng)) return { lat: asOrigin.origin_lat, lng: asOrigin.origin_lng, text: cityText };
  const { data: asDest } = await db.from('predefined_routes').select('dest_lat, dest_lng').eq('destination_city', pkg.origen).limit(1).maybeSingle();
  if (asDest && isNum(asDest.dest_lat) && isNum(asDest.dest_lng)) return { lat: asDest.dest_lat, lng: asDest.dest_lng, text: cityText };
  return null;
};

/** Viaje planeado y espacio libre: { route, freeKg } o { error }. Se usa al proponer y, de nuevo, al ejecutar. */
export const checkRouteForPackage = async (db, routeRef, weightKg) => {
  const ref = String(routeRef ?? '').trim();
  const q = db.from('transport_routes').select('id, route_code, origin, destination, status, departure_time, vehicle_id');
  const { data: route } = await (UUID_RE.test(ref) ? q.eq('id', ref) : q.eq('route_code', ref)).maybeSingle();
  if (!route) return { error: 'No encontré ese viaje. Pídele al usuario que elija uno de los que mostró la disponibilidad.' };
  if (route.status !== 'planeada') return { error: 'Ese viaje ya no está disponible para agendar (no está planeado).' };

  let freeKg = null;
  if (route.vehicle_id) {
    const [{ data: vehicle }, { data: loads }] = await Promise.all([
      db.from('vehicles').select('capacity_kg').eq('id', route.vehicle_id).maybeSingle(),
      db.from('packages').select('peso').eq('route_id', route.id),
    ]);
    const capacity = vehicle?.capacity_kg != null ? Number(vehicle.capacity_kg) : null;
    const used = (loads || []).reduce((s, p) => s + (Number(p.peso) || 0), 0);
    if (capacity != null) freeKg = Math.round((capacity - used) * 10) / 10;
  }
  if (freeKg != null && weightKg != null && freeKg < weightKg) {
    return { error: `El viaje no tiene espacio: quedan ${Math.max(0, freeKg)} kg y el paquete pesa ${weightKg} kg.` };
  }
  return { route, freeKg };
};

const whenText = (iso) => new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const omitted = (skipped) => (skipped.length ? [`Se omiten ${skipped.length}: ${skipped.map((s) => `${s.code} (${s.reason})`).join('; ')}`] : []);

/**
 * Prepara la propuesta de asignar paquetes a un viaje. La usan la herramienta del agente y el botón "Preparar asignación"
 * de las sugerencias (sin pasar por el modelo). Devuelve el JSON de la propuesta o un texto con el motivo del rechazo.
 */
export const prepareAssignProposal = async (user, db, { code, codes, route_ref }) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const parsed = normalizeCodes({ code, codes });
    if (parsed.error) return parsed.error;

    const found = [];
    const skipped = [];
    for (const c of parsed.codes) {
      const pkg = await findPackage(db, c);
      if (!pkg) { skipped.push({ code: c, reason: 'no existe' }); continue; }
      if (!ASSIGNABLE.includes(pkg.status)) { skipped.push({ code: pkg.tracking_code, reason: `está ${STATUS_TEXT[pkg.status].toLowerCase()}; solo se asignan paquetes pendientes o asignados` }); continue; }
      found.push(pkg);
    }
    if (found.length === 0) return `No hay ningún paquete que se pueda asignar (${skipped.map((s) => `${s.code}: ${s.reason}`).join('; ')}).`;

    // el viaje debe estar planeado y tener espacio para TODOS los paquetes juntos
    const totalKg = Math.round(found.reduce((s, p) => s + (Number(p.peso) || 0), 0) * 10) / 10;
    const check = await checkRouteForPackage(db, route_ref, totalKg);
    if (check.error) return check.error;

    // aviso (no bloqueo): el paquete va a otro destino que el viaje
    const mismatched = found.filter((p) => String(p.destino).toLowerCase() !== String(check.route.destination).toLowerCase());
    const proposal = createProposal({
      user,
      type: 'assign_package',
      params: { route_id: check.route.id, items: found.map((p) => ({ package_id: p.id, tracking_code: p.tracking_code, peso: Number(p.peso) || 0 })) },
      title: found.length === 1 ? 'Asignar un paquete a un viaje' : `Asignar ${found.length} paquetes a un viaje`,
      lines: [
    `Viaje: ${check.route.origin} → ${check.route.destination}, sale ${whenText(check.route.departure_time)}`,
    found.length === 1
      ? `Paquete: ${found[0].tracking_code} (${found[0].origen} → ${found[0].destino}, ${found[0].peso} kg)`
      : `Paquetes (${found.length}): ${found.map((p) => p.tracking_code).join(', ')} — ${totalKg} kg en total`,
    ...(check.freeKg != null ? [`Espacio libre del viaje: ${check.freeKg} kg`] : []),
    ...(mismatched.length ? [`Aviso: ${mismatched.map((p) => `${p.tracking_code} va a ${p.destino}`).join(', ')}, distinto del destino del viaje`] : []),
    ...omitted(skipped),
      ],
    });
    return proposalResult(proposal, skipped);
  } catch (e) {
    return `No se pudo preparar la acción: ${e.message}`;
  }
};

/**
 * Prepara la propuesta de registrar un paquete (y agendarlo si se indica un viaje). La usan la herramienta del agente y la
 * lectura de guías por foto, donde una persona revisó los datos. Devuelve el JSON de la propuesta o el motivo del rechazo.
 */
export const prepareCreateProposal = async (user, db, input) => {
  try {
    if (!OPS.includes(user.role)) return DENIED;
    const parsed = packageSchema.safeParse({
      origen: input.origen,
      destino: input.destino,
      peso: input.peso,
      recipient_name: input.recipient_name,
      ...(input.recipient_phone ? { recipient_phone: input.recipient_phone } : {}),
      ...(input.sender_name ? { sender_name: input.sender_name } : {}),
      ...(input.sender_phone ? { sender_phone: input.sender_phone } : {}),
      ...(input.description ? { description: input.description } : {}),
    });
    if (!parsed.success) {
      const problems = Object.entries(parsed.error.flatten().fieldErrors).map(([f, m]) => `${f}: ${m[0]}`).join('; ');
    return `Faltan o son inválidos algunos datos del paquete (${problems}). Pídeselos al usuario.`;
    }
    const d = parsed.data;

    let tripLine = null;
    if (input.route_ref) {
      const check = await checkRouteForPackage(db, input.route_ref, d.peso);
      if (check.error) return check.error;
      d.route_id = check.route.id;
      tripLine = `Se agenda en el viaje ${check.route.origin} → ${check.route.destination}, sale ${whenText(check.route.departure_time)}`;
    }

    const proposal = createProposal({
      user,
      type: 'create_package',
      params: { data: d },
      title: tripLine ? 'Registrar un paquete y agendarlo' : 'Registrar un paquete nuevo',
      lines: [
        `Ruta: ${d.origen} → ${d.destino}`,
        ...(tripLine ? [tripLine] : []),
        `Peso: ${d.peso} kg`,
        `Destinatario: ${d.recipient_name}${d.recipient_phone ? ` (${d.recipient_phone})` : ''}`,
        ...(d.sender_name ? [`Remitente: ${d.sender_name}${d.sender_phone ? ` (${d.sender_phone})` : ''}`] : []),
        ...(d.description ? [`Descripción: ${d.description}`] : []),
      ],
    });
    return proposalResult(proposal);
  } catch (e) {
    return `No se pudo preparar la acción: ${e.message}`;
  }
};

export const buildActionTools = (user, db) => {
  // ------------------------------------------------------------------ registrar evento (uno o varios paquetes)
  const proposeEvent = tool(
    async ({ code, codes, status, note }) => {
      try {
        if (!OPS.includes(user.role)) return DENIED;
        if (!EVENT_STATUS[status]) return 'Estado no permitido. Usa en_transito, en_agencia o siniestro.';
        const observations = cleanNote(note);
        if (observations === null) return `La nota es demasiado larga (máximo ${MAX_NOTE} caracteres).`;
        const parsed = normalizeCodes({ code, codes });
        if (parsed.error) return parsed.error;

        const items = [];
        const skipped = [];
        for (const c of parsed.codes) {
          const pkg = await findPackage(db, c);
          if (!pkg) { skipped.push({ code: c, reason: 'no existe' }); continue; }
          if (FINAL.includes(pkg.status)) { skipped.push({ code: pkg.tracking_code, reason: `ya está ${STATUS_TEXT[pkg.status].toLowerCase()}` }); continue; }
          const where = await locateForEvent(db, pkg);
          if (!where) { skipped.push({ code: pkg.tracking_code, reason: 'sin ubicación para el evento' }); continue; }
          items.push({ package_id: pkg.id, tracking_code: pkg.tracking_code, lat: where.lat, lng: where.lng, _pkg: pkg, _where: where.text });
        }
        if (items.length === 0) {
          if (parsed.codes.length === 1) {
            const s = skipped[0];
            if (s.reason === 'no existe') return 'No se encontró ningún paquete con ese código.';
            if (s.reason === 'sin ubicación para el evento') return 'No tengo ninguna ubicación de ese paquete para registrar el evento. Regístralo desde la pantalla de Tracking indicando las coordenadas.';
            return `El paquete ${s.reason} y no admite nuevos estados.`;
          }
          return `No hay ningún paquete al que se pueda registrar el evento (${skipped.map((s) => `${s.code}: ${s.reason}`).join('; ')}).`;
        }

        const first = items[0];
        const lines = items.length === 1
          ? [
              `Paquete: ${first.tracking_code} (${first._pkg.origen} → ${first._pkg.destino})`,
              `Estado actual: ${STATUS_TEXT[first._pkg.status] ?? first._pkg.status}`,
              `Estado nuevo: ${EVENT_STATUS[status]}`,
              `Ubicación: ${first._where}`,
              ...(observations ? [`Nota: ${observations}`] : []),
              ...omitted(skipped),
            ]
          : [
              `Paquetes (${items.length}): ${items.map((i) => i.tracking_code).join(', ')}`,
              `Estado nuevo para todos: ${EVENT_STATUS[status]}`,
              'Ubicación: la última conocida de cada paquete',
              ...(observations ? [`Nota: ${observations}`] : []),
              ...omitted(skipped),
            ];
        const proposal = createProposal({
          user,
          type: 'register_tracking_event',
          params: {
            status,
            observations: observations || undefined,
            items: items.map(({ package_id, tracking_code, lat, lng }) => ({ package_id, tracking_code, lat, lng })),
          },
          title: items.length === 1 ? 'Registrar evento de seguimiento' : `Registrar evento en ${items.length} paquetes`,
          lines,
        });
        return proposalResult(proposal, skipped);
      } catch (e) {
        return `No se pudo preparar la acción: ${e.message}`;
      }
    },
    {
      name: 'propose_register_event',
      description: `PROPONE registrar un evento de seguimiento (en_transito, en_agencia o siniestro) para uno o varios paquetes (hasta ${MAX_BATCH}, con UNA sola confirmación), con una nota opcional. No lo ejecuta: el usuario debe confirmarlo en la tarjeta. Solo administradores y operadores. Úsala para "registra que el paquete llegó a la agencia", "marca estos tres paquetes como siniestro", etc.`,
      schema: z.object({
        code: z.string().optional().describe('Código de rastreo de un paquete (TRK-...)'),
        codes: z.array(z.string()).optional().describe('Códigos de varios paquetes, para el mismo evento'),
        status: z.enum(['en_transito', 'en_agencia', 'siniestro']).describe('Estado del evento'),
        note: z.string().optional().describe('Nota opcional (máximo 500 caracteres)'),
      }),
    }
  );

  // ------------------------------------------------------------------ entregar (uno o varios paquetes)
  const proposeDeliver = tool(
    async ({ code, codes, note }) => {
      try {
        if (![...OPS, 'driver'].includes(user.role)) return DENIED;
        const observations = cleanNote(note);
        if (observations === null) return `La nota es demasiado larga (máximo ${MAX_NOTE} caracteres).`;
        const parsed = normalizeCodes({ code, codes });
        if (parsed.error) return parsed.error;

        const items = [];
        const skipped = [];
        const routeOwner = new Map(); // caché: ruta → conductor
        for (const c of parsed.codes) {
          const pkg = await findPackage(db, c);
          if (!pkg) { skipped.push({ code: c, reason: 'no existe' }); continue; }
          if (pkg.status === PACKAGE_STATUS.DELIVERED) { skipped.push({ code: pkg.tracking_code, reason: 'ya fue entregado' }); continue; }
          if (FINAL.includes(pkg.status)) { skipped.push({ code: pkg.tracking_code, reason: `está ${STATUS_TEXT[pkg.status].toLowerCase()} y no puede entregarse` }); continue; }

          if (user.role === 'driver') {
            // un conductor solo entrega paquetes de SUS rutas (el servidor lo vuelve a exigir al confirmar)
            if (pkg.route_id && !routeOwner.has(pkg.route_id)) {
              const { data: route } = await db.from('transport_routes').select('driver_id').eq('id', pkg.route_id).maybeSingle();
              routeOwner.set(pkg.route_id, route?.driver_id ?? null);
            }
            if (!pkg.route_id || routeOwner.get(pkg.route_id) !== user.id) { skipped.push({ code: pkg.tracking_code, reason: 'no es de tus rutas' }); continue; }
          }
          items.push(pkg);
        }
        if (items.length === 0) {
          if (parsed.codes.length === 1) {
            const s = skipped[0];
            if (s.reason === 'no es de tus rutas') return DENIED;
            if (s.reason === 'no existe') return 'No se encontró ningún paquete con ese código.';
            return s.reason === 'ya fue entregado' ? 'Ese paquete ya fue entregado.' : `El paquete ${s.reason}.`;
          }
          return `No hay ningún paquete que se pueda entregar (${skipped.map((s) => `${s.code}: ${s.reason}`).join('; ')}).`;
        }

        const first = items[0];
        const lines = items.length === 1
          ? [
              `Paquete: ${first.tracking_code}`,
              `Destino: ${first.destino}`,
              `Estado actual: ${STATUS_TEXT[first.status] ?? first.status}`,
              'Pasará a: Entregado',
              ...(observations ? [`Nota de entrega: ${observations}`] : []),
              ...omitted(skipped),
            ]
          : [
              `Paquetes (${items.length}): ${items.map((i) => i.tracking_code).join(', ')}`,
              'Pasarán a: Entregado',
              ...(observations ? [`Nota de entrega: ${observations}`] : []),
              ...omitted(skipped),
            ];
        const proposal = createProposal({
          user,
          type: 'deliver_package',
          params: { items: items.map((p) => ({ package_id: p.id, tracking_code: p.tracking_code })), note: observations || undefined },
          title: items.length === 1 ? 'Confirmar entrega de un paquete' : `Confirmar entrega de ${items.length} paquetes`,
          lines,
        });
        return proposalResult(proposal, skipped);
      } catch (e) {
        return `No se pudo preparar la acción: ${e.message}`;
      }
    },
    {
      name: 'propose_deliver_package',
      description: `PROPONE marcar como entregado uno o varios paquetes (hasta ${MAX_BATCH}, con UNA sola confirmación), con una nota opcional. No lo ejecuta: el usuario debe confirmarlo en la tarjeta. Administradores, operadores y conductores (estos últimos solo paquetes de sus rutas). Úsala para "entrega el paquete TRK-...", "ya entregué estos dos paquetes".`,
      schema: z.object({
        code: z.string().optional().describe('Código de rastreo de un paquete (TRK-...)'),
        codes: z.array(z.string()).optional().describe('Códigos de varios paquetes entregados juntos'),
        note: z.string().optional().describe('Nota de entrega opcional, por ejemplo quién recibió'),
      }),
    }
  );

  // ------------------------------------------------------------------ crear (y opcionalmente agendar en un viaje)
  const proposeCreate = tool(
    async (input) => prepareCreateProposal(user, db, input),
    {
      name: 'propose_create_package',
      description: 'PROPONE registrar un paquete nuevo (origen, destino, peso en kg y nombre del destinatario son obligatorios; teléfono, remitente y descripción son opcionales) y, con route_ref, agendarlo en un viaje concreto. No lo crea: el usuario debe confirmarlo en la tarjeta. Solo administradores y operadores. Si falta algún dato obligatorio, pídeselo al usuario antes de llamarla. El viaje es OPCIONAL: si el usuario no pidió un viaje concreto, llámala sin route_ref (queda como carga suelta) y NO busques viajes antes.',
      schema: z.object({
        origen: z.string().describe('Ciudad de origen'),
        destino: z.string().describe('Ciudad de destino'),
        peso: z.number().describe('Peso en kilogramos'),
        recipient_name: z.string().describe('Nombre del destinatario'),
        route_ref: z.string().optional().describe('Viaje en el que agendarlo: el campo ref devuelto por find_available_trips'),
        recipient_phone: z.string().optional().describe('Teléfono del destinatario'),
        sender_name: z.string().optional().describe('Nombre del remitente'),
        sender_phone: z.string().optional().describe('Teléfono del remitente'),
        description: z.string().optional().describe('Contenido o referencia del paquete'),
      }),
    }
  );

  // ------------------------------------------------------------------ asignar paquetes existentes a un viaje
  const proposeAssign = tool(
    async (args) => prepareAssignProposal(user, db, args),
    {
      name: 'propose_assign_package',
      description: `PROPONE asignar uno o varios paquetes ya registrados (pendientes o asignados) a un viaje planeado, comprobando que haya espacio para todos. Hasta ${MAX_BATCH} paquetes con UNA sola confirmación. No lo ejecuta. Solo administradores y operadores. Úsala para "pon estos paquetes en el viaje del viernes" o "asigna TRK-... a ese viaje". El viaje (route_ref) sale de find_available_trips.`,
      schema: z.object({
        code: z.string().optional().describe('Código de rastreo de un paquete'),
        codes: z.array(z.string()).optional().describe('Códigos de varios paquetes'),
        route_ref: z.string().describe('Viaje: el campo ref devuelto por find_available_trips'),
      }),
    }
  );

  return [proposeEvent, proposeDeliver, proposeCreate, proposeAssign];
};
