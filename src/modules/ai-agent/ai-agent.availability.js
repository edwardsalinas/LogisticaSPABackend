import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Disponibilidad para agendar: "¿qué viajes a La Paz hay el viernes de 3 a 5 con espacio?" y, para el personal,
 * "¿qué vehículos y conductores están libres en ese horario?". Solo lectura. Las horas son de Bolivia (UTC-4).
 */
const TZ_OFFSET_MS = -4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPS = ['admin', 'logistics_operator'];
const MAX_TRIPS = 8;
const DEFAULT_TRIP_HOURS = 2; // sin llegada estimada se supone esta duración para detectar choques de horario
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DENIED = 'No tienes permiso para consultar esa información.';
const asText = (v) => JSON.stringify(v);
const round1 = (n) => Math.round(n * 10) / 10;

/** Ciudad o texto libre → solo letras, números, espacios y guion (se usa dentro de un filtro ilike). */
const cleanCity = (s) => String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Fecha + horas de Bolivia → ventana en UTC (ISO). Devuelve { error } si algo no es válido. */
export const parseWindow = ({ date, from_time = '00:00', to_time = '23:59' }) => {
  if (!DATE_RE.test(String(date ?? ''))) return { error: 'Indica la fecha en formato AAAA-MM-DD.' };
  if (!TIME_RE.test(from_time) || !TIME_RE.test(to_time)) return { error: 'Las horas deben tener el formato HH:mm (por ejemplo 15:00).' };
  const day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day)) return { error: 'La fecha no es válida.' };
  const at = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return day + (h * 60 + m) * 60000 - TZ_OFFSET_MS;
  };
  const start = at(from_time);
  const end = at(to_time);
  if (end < start) return { error: 'La hora final debe ser posterior a la inicial.' };
  return { start, end, fromISO: new Date(start).toISOString(), toISO: new Date(end).toISOString() };
};

// "Volvo" + "Volvo FH16" → "Volvo FH16": si el modelo ya empieza por la marca no se repite
const vehicleText = (v) => {
  if (!v) return null;
  const model = v.model ?? '';
  const brand = v.brand && !model.toLowerCase().startsWith(String(v.brand).toLowerCase()) ? v.brand : null;
  return [v.plate, brand, model].filter(Boolean).join(' ');
};

/** ¿Se solapan [aStart,aEnd] y [bStart,bEnd]? */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

export const buildAvailabilityTools = (user, db) => {
  const findAvailableTrips = tool(
    async ({ date, from_time, to_time, origin, destination, weight_kg }) => {
      try {
        const win = parseWindow({ date, from_time, to_time });
        if (win.error) return win.error;
        const kg = weight_kg == null ? null : Number(weight_kg);
        if (kg != null && (!Number.isFinite(kg) || kg <= 0)) return 'El peso debe ser un número positivo en kilogramos.';
        const dest = cleanCity(destination);
        const orig = cleanCity(origin);

        const base = () => {
          let q = db
            .from('transport_routes')
            .select('id, route_code, origin, destination, status, departure_time, estimated_arrival, vehicle_id')
            .eq('status', 'planeada')
            .order('departure_time', { ascending: true });
          if (dest) q = q.ilike('destination', `%${dest}%`);
          if (orig) q = q.ilike('origin', `%${orig}%`);
          return q;
        };

        const { data: routes, error } = await base().gte('departure_time', win.fromISO).lte('departure_time', win.toISO).limit(MAX_TRIPS);
        if (error) throw error;

        const enrich = async (list) => {
          const vehicleIds = [...new Set(list.map((r) => r.vehicle_id).filter(Boolean))];
          const routeIds = list.map((r) => r.id);
          const [vehicles, loads] = await Promise.all([
            vehicleIds.length ? db.from('vehicles').select('id, plate, brand, model, capacity_kg').in('id', vehicleIds) : { data: [] },
            routeIds.length ? db.from('packages').select('route_id, peso').in('route_id', routeIds) : { data: [] },
          ]);
          const vById = Object.fromEntries((vehicles.data || []).map((v) => [v.id, v]));
          const used = {};
          for (const p of loads.data || []) used[p.route_id] = (used[p.route_id] || 0) + (Number(p.peso) || 0);
          return list.map((r) => {
            const v = vById[r.vehicle_id];
            const capacity = v?.capacity_kg != null ? Number(v.capacity_kg) : null;
            const usedKg = round1(used[r.id] || 0);
            const free = capacity != null ? round1(capacity - usedKg) : null;
            return {
              ref: r.route_code || r.id, // lo que se pasa a propose_create_package para agendar en este viaje
              origin: r.origin,
              destination: r.destination,
              departure_time: r.departure_time,
              estimated_arrival: r.estimated_arrival,
              vehicle: vehicleText(v),
              capacity_kg: capacity,
              used_kg: usedKg,
              free_kg: free,
              fits: kg == null ? (free == null ? null : free > 0) : free == null ? null : free >= kg,
            };
          });
        };

        const trips = await enrich(routes || []);
        // Si no hay nada en esa ventana, se ofrecen los siguientes viajes (14 días) para que la conversación avance
        let alternatives = [];
        if (trips.length === 0) {
          const { data: next } = await base().gte('departure_time', win.toISO).lte('departure_time', new Date(win.end + 14 * DAY_MS).toISOString()).limit(3);
          alternatives = await enrich(next || []);
        }
        return asText({
          kind: 'available_trips',
          query: { date, from_time: from_time ?? '00:00', to_time: to_time ?? '23:59', origin: orig || null, destination: dest || null, weight_kg: kg },
          trips,
          alternatives,
          can_schedule: OPS.includes(user.role),
        });
      } catch (e) {
        return `No se pudo consultar la disponibilidad: ${e.message}`;
      }
    },
    {
      name: 'find_available_trips',
      description:
        'Busca viajes planeados en una fecha y horario (hora de Bolivia), opcionalmente por origen y destino, e indica cuánto espacio libre queda (kg) en cada uno. Si no hay ninguno en esa ventana devuelve los próximos viajes alternativos. Úsala para "¿qué viajes a La Paz hay el viernes de 3 a 5?", "¿hay espacio para 20 kg?" o "¿cuándo sale el próximo a Oruro?". Convierte días como "viernes" o "mañana" a fecha AAAA-MM-DD usando el calendario del sistema.',
      schema: z.object({
        date: z.string().describe('Fecha AAAA-MM-DD'),
        from_time: z.string().optional().describe('Hora inicial HH:mm (por defecto 00:00)'),
        to_time: z.string().optional().describe('Hora final HH:mm (por defecto 23:59)'),
        origin: z.string().optional().describe('Ciudad de origen'),
        destination: z.string().optional().describe('Ciudad de destino'),
        weight_kg: z.number().optional().describe('Peso del paquete en kg, para saber si cabe'),
      }),
    }
  );

  const checkFleetAvailability = tool(
    async ({ date, from_time, to_time }) => {
      try {
        if (!OPS.includes(user.role)) return DENIED;
        const win = parseWindow({ date, from_time, to_time });
        if (win.error) return win.error;

        const [vehicles, drivers, routes] = await Promise.all([
          db.from('vehicles').select('id, plate, brand, model, type, capacity_kg, status').limit(50),
          db.from('drivers').select('id, full_name, status').limit(50),
          db
            .from('transport_routes')
            .select('vehicle_id, driver_id, departure_time, estimated_arrival, origin, destination')
            .in('status', ['planeada', 'en_transito'])
            .gte('departure_time', new Date(win.start - 24 * 60 * 60 * 1000).toISOString())
            .lte('departure_time', win.toISO)
            .limit(200),
        ]);
        if (vehicles.error) throw vehicles.error;
        if (drivers.error) throw drivers.error;
        if (routes.error) throw routes.error;

        const busyV = new Set();
        const busyD = new Set();
        for (const r of routes.data || []) {
          const s = Date.parse(r.departure_time);
          const e = r.estimated_arrival ? Date.parse(r.estimated_arrival) : s + DEFAULT_TRIP_HOURS * 60 * 60 * 1000;
          if (overlaps(s, e, win.start, win.end)) {
            if (r.vehicle_id) busyV.add(r.vehicle_id);
            if (r.driver_id) busyD.add(r.driver_id);
          }
        }
        const v = (list) => list.map((x) => ({ plate: x.plate, vehicle: vehicleText(x), type: x.type, capacity_kg: x.capacity_kg != null ? Number(x.capacity_kg) : null }));
        const d = (list) => list.map((x) => ({ name: x.full_name }));
        return asText({
          kind: 'fleet_availability',
          window: { date, from_time: from_time ?? '00:00', to_time: to_time ?? '23:59' },
          vehicles_free: v((vehicles.data || []).filter((x) => !busyV.has(x.id))),
          vehicles_busy: v((vehicles.data || []).filter((x) => busyV.has(x.id))),
          drivers_free: d((drivers.data || []).filter((x) => !busyD.has(x.id))),
          drivers_busy: d((drivers.data || []).filter((x) => busyD.has(x.id))),
          assumption: `Un viaje sin llegada estimada se considera de ${DEFAULT_TRIP_HOURS} horas desde su salida.`,
        });
      } catch (e) {
        return `No se pudo consultar la disponibilidad de la flota: ${e.message}`;
      }
    },
    {
      name: 'check_fleet_availability',
      description: 'Qué vehículos y conductores están libres u ocupados en una fecha y horario (hora de Bolivia). Solo administradores y operadores. Úsala para "¿qué camiones están libres el viernes de 3 a 5?" o "¿quién puede hacer un viaje mañana por la mañana?".',
      schema: z.object({
        date: z.string().describe('Fecha AAAA-MM-DD'),
        from_time: z.string().optional().describe('Hora inicial HH:mm (por defecto 00:00)'),
        to_time: z.string().optional().describe('Hora final HH:mm (por defecto 23:59)'),
      }),
    }
  );

  return [findAvailableTrips, checkFleetAvailability];
};
