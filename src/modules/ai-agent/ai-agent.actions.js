import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createProposal } from './ai-actions.service.js';
import { PACKAGE_STATUS } from '../logistics/logistics.schema.js';
import { packageSchema } from '../logistics/logistics.schema.js';

/**
 * Herramientas que PROPONEN acciones. Ninguna modifica datos: validan permisos, estado y datos, y devuelven una
 * propuesta (id + resumen redactado aquí, no por el modelo) que el usuario debe confirmar en pantalla.
 */
const OPS = ['admin', 'logistics_operator'];
const FINAL = [PACKAGE_STATUS.DELIVERED, PACKAGE_STATUS.RETURNED, PACKAGE_STATUS.CANCELLED];
const EVENT_STATUS = { en_transito: 'En tránsito', en_agencia: 'En agencia', siniestro: 'Siniestro' };
const STATUS_TEXT = {
  pendiente: 'Pendiente', asignado: 'Asignado', en_transito: 'En tránsito', en_agencia: 'En agencia',
  entregado: 'Entregado', siniestro: 'Siniestro', devuelto: 'Devuelto', cancelado: 'Cancelado',
};
const DENIED = 'No tienes permiso para realizar esa acción.';
const MAX_NOTE = 500;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const asText = (value) => JSON.stringify(value);
const proposalResult = (proposal) => asText({
  kind: 'action_proposal',
  action: proposal,
  instruction: 'La acción NO se ha ejecutado. Dile al usuario que revise la tarjeta y pulse Confirmar; no afirmes que ya está hecha.',
});

const findPackage = async (db, code) => {
  if (typeof code !== 'string' || code.trim().length < 3 || code.length > 64) return { error: 'Indica un código de rastreo válido (empieza con TRK-).' };
  const { data, error } = await db
    .from('packages')
    .select('id, tracking_code, status, origen, destino, route_id')
    .eq('tracking_code', code.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: 'No se encontró ningún paquete con ese código.' };
  return { pkg: data };
};

const cleanNote = (note) => {
  const n = typeof note === 'string' ? note.trim() : '';
  return n.length > MAX_NOTE ? null : n;
};

export const buildActionTools = (user, db) => {
  const proposeEvent = tool(
    async ({ code, status, note }) => {
      try {
        if (!OPS.includes(user.role)) return DENIED;
        if (!EVENT_STATUS[status]) return 'Estado no permitido. Usa en_transito, en_agencia o siniestro.';
        const observations = cleanNote(note);
        if (observations === null) return `La nota es demasiado larga (máximo ${MAX_NOTE} caracteres).`;
        const { pkg, error } = await findPackage(db, code);
        if (error) return error;
        if (FINAL.includes(pkg.status)) return `El paquete ya está ${STATUS_TEXT[pkg.status].toLowerCase()} y no admite nuevos estados.`;

        // tracking_logs exige coordenadas: última posición conocida; si no hay, el origen de su ruta; si tampoco, la ciudad de origen
        let position = null;
        let positionText = 'la última posición conocida del paquete';
        const { data: logs } = await db.from('tracking_logs').select('lat, lng').eq('package_id', pkg.id).order('timestamp', { ascending: false }).limit(5);
        position = (logs || []).find((l) => isNum(l.lat) && isNum(l.lng) && !(l.lat === 0 && l.lng === 0)) ?? null;
        if (!position && pkg.route_id) {
          const { data: route } = await db.from('transport_routes').select('origin_lat, origin_lng').eq('id', pkg.route_id).maybeSingle();
          if (route && isNum(route.origin_lat) && isNum(route.origin_lng)) {
            position = { lat: route.origin_lat, lng: route.origin_lng };
            positionText = 'el punto de origen de su ruta';
          }
        }
        if (!position) {
          const { data: asOrigin } = await db.from('predefined_routes').select('origin_lat, origin_lng').eq('origin_city', pkg.origen).limit(1).maybeSingle();
          if (asOrigin && isNum(asOrigin.origin_lat) && isNum(asOrigin.origin_lng)) {
            position = { lat: asOrigin.origin_lat, lng: asOrigin.origin_lng };
          } else {
            const { data: asDest } = await db.from('predefined_routes').select('dest_lat, dest_lng').eq('destination_city', pkg.origen).limit(1).maybeSingle();
            if (asDest && isNum(asDest.dest_lat) && isNum(asDest.dest_lng)) position = { lat: asDest.dest_lat, lng: asDest.dest_lng };
          }
          if (position) positionText = `la ciudad de origen (${pkg.origen}), porque el paquete aún no tiene posición GPS`;
        }
        if (!position) return 'No tengo ninguna ubicación de ese paquete para registrar el evento. Regístralo desde la pantalla de Tracking indicando las coordenadas.';

        const proposal = createProposal({
          user,
          type: 'register_tracking_event',
          params: { package_id: pkg.id, tracking_code: pkg.tracking_code, status, lat: position.lat, lng: position.lng, observations: observations || undefined },
          title: 'Registrar evento de seguimiento',
          lines: [
            `Paquete: ${pkg.tracking_code} (${pkg.origen} → ${pkg.destino})`,
            `Estado actual: ${STATUS_TEXT[pkg.status] ?? pkg.status}`,
            `Estado nuevo: ${EVENT_STATUS[status]}`,
            `Ubicación: ${positionText}`,
            ...(observations ? [`Nota: ${observations}`] : []),
          ],
        });
        return proposalResult(proposal);
      } catch (e) {
        return `No se pudo preparar la acción: ${e.message}`;
      }
    },
    {
      name: 'propose_register_event',
      description: 'PROPONE registrar un evento de seguimiento (en_transito, en_agencia o siniestro) para un paquete, con una nota opcional. No lo ejecuta: el usuario debe confirmarlo en la tarjeta. Solo administradores y operadores. Úsala cuando pidan "registra que el paquete llegó a la agencia", "marca el paquete como siniestro", etc.',
      schema: z.object({
        code: z.string().describe('Código de rastreo del paquete (TRK-...)'),
        status: z.enum(['en_transito', 'en_agencia', 'siniestro']).describe('Estado del evento'),
        note: z.string().optional().describe('Nota opcional (máximo 500 caracteres)'),
      }),
    }
  );

  const proposeDeliver = tool(
    async ({ code, note }) => {
      try {
        if (![...OPS, 'driver'].includes(user.role)) return DENIED;
        const observations = cleanNote(note);
        if (observations === null) return `La nota es demasiado larga (máximo ${MAX_NOTE} caracteres).`;
        const { pkg, error } = await findPackage(db, code);
        if (error) return error;
        if (pkg.status === PACKAGE_STATUS.DELIVERED) return 'Ese paquete ya fue entregado.';
        if (FINAL.includes(pkg.status)) return `El paquete está ${STATUS_TEXT[pkg.status].toLowerCase()} y no puede entregarse.`;

        if (user.role === 'driver') {
          // un conductor solo entrega paquetes de SUS rutas (el servidor lo vuelve a exigir al confirmar)
          const { data: route } = pkg.route_id ? await db.from('transport_routes').select('driver_id').eq('id', pkg.route_id).maybeSingle() : { data: null };
          if (!route || route.driver_id !== user.id) return DENIED;
        }

        const proposal = createProposal({
          user,
          type: 'deliver_package',
          params: { package_id: pkg.id, tracking_code: pkg.tracking_code, note: observations || undefined },
          title: 'Confirmar entrega de un paquete',
          lines: [
            `Paquete: ${pkg.tracking_code}`,
            `Destino: ${pkg.destino}`,
            `Estado actual: ${STATUS_TEXT[pkg.status] ?? pkg.status}`,
            'Pasará a: Entregado',
            ...(observations ? [`Nota de entrega: ${observations}`] : []),
          ],
        });
        return proposalResult(proposal);
      } catch (e) {
        return `No se pudo preparar la acción: ${e.message}`;
      }
    },
    {
      name: 'propose_deliver_package',
      description: 'PROPONE marcar un paquete como entregado, con una nota opcional. No lo ejecuta: el usuario debe confirmarlo en la tarjeta. Administradores, operadores y conductores (estos últimos solo paquetes de sus rutas). Úsala para "entrega el paquete TRK-...", "ya entregué este paquete".',
      schema: z.object({
        code: z.string().describe('Código de rastreo del paquete (TRK-...)'),
        note: z.string().optional().describe('Nota de entrega opcional, por ejemplo quién recibió'),
      }),
    }
  );

  const proposeCreate = tool(
    async (input) => {
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
        const proposal = createProposal({
          user,
          type: 'create_package',
          params: { data: d },
          title: 'Registrar un paquete nuevo',
          lines: [
            `Ruta: ${d.origen} → ${d.destino}`,
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
    },
    {
      name: 'propose_create_package',
      description: 'PROPONE registrar un paquete nuevo (origen, destino, peso en kg y nombre del destinatario son obligatorios; teléfono, remitente y descripción son opcionales). No lo crea: el usuario debe confirmarlo en la tarjeta. Solo administradores y operadores. Si falta algún dato obligatorio, pídeselo al usuario antes de llamarla.',
      schema: z.object({
        origen: z.string().describe('Ciudad de origen'),
        destino: z.string().describe('Ciudad de destino'),
        peso: z.number().describe('Peso en kilogramos'),
        recipient_name: z.string().describe('Nombre del destinatario'),
        recipient_phone: z.string().optional().describe('Teléfono del destinatario'),
        sender_name: z.string().optional().describe('Nombre del remitente'),
        sender_phone: z.string().optional().describe('Teléfono del remitente'),
        description: z.string().optional().describe('Contenido o referencia del paquete'),
      }),
    }
  );

  return [proposeEvent, proposeDeliver, proposeCreate];
};
