import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { enrichTrips } from './ai-agent.availability.js';
import { MAX_BATCH } from './ai-agent.actions.js';

/**
 * Sugerencias de asignación: reparte los paquetes SUELTOS (registrados, sin viaje) entre los viajes planeados que
 * hacen su misma ruta y tienen espacio. Es solo lectura: no asigna nada. Cada grupo sugerido se puede convertir en una
 * propuesta con un clic (que el usuario confirma), igual que las acciones del asistente.
 */
const OPS = ['admin', 'logistics_operator'];
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_LOOSE = 40;
const MAX_TRIPS = 60;
const HORIZON_DAYS = 14;
const round1 = (n) => Math.round(n * 10) / 10;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Misma ciudad aunque cambien mayúsculas, tildes o haya texto de más ("La Paz" ~ "La Paz, Bolivia"). */
export const sameCity = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const label = (t) => `${t.origin} → ${t.destination}`;

/**
 * Reparte los paquetes entre los viajes. Función pura.
 *  - un paquete solo va a un viaje con SU origen y destino, que aún no haya salido;
 *  - se prefiere el viaje que sale antes, mientras quede espacio (se descuenta el peso al asignar);
 *  - los paquetes más antiguos se atienden primero;
 *  - si un viaje no tiene dato de capacidad se permite, pero se marca para que el usuario lo sepa.
 * @param {{ packages: object[], trips: object[], now?: number }} input
 */
export const planAssignments = ({ packages, trips, now = Date.now() }) => {
  const open = trips
    .filter((t) => new Date(t.departure_time).getTime() >= now)
    .sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time))
    .map((t) => ({ ...t, remaining: t.free_kg ?? null }));

  const byTrip = new Map();
  const unassigned = [];
  const queue = [...packages].sort((a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0));

  for (const p of queue) {
    const weight = Number(p.peso);
    if (!Number.isFinite(weight) || weight <= 0) {
      unassigned.push({ tracking_code: p.tracking_code, peso: p.peso ?? null, reason: 'no tiene un peso registrado' });
      continue;
    }
    const sameRoute = open.filter((t) => sameCity(t.origin, p.origen) && sameCity(t.destination, p.destino));
    if (sameRoute.length === 0) {
      unassigned.push({ tracking_code: p.tracking_code, peso: weight, reason: `no hay un viaje planeado de ${p.origen} a ${p.destino}` });
      continue;
    }
    const trip = sameRoute.find((t) => t.remaining == null || t.remaining >= weight);
    if (!trip) {
      const best = sameRoute.reduce((a, b) => ((b.remaining ?? 0) > (a.remaining ?? 0) ? b : a));
      unassigned.push({ tracking_code: p.tracking_code, peso: weight, reason: `no cabe: el viaje con más espacio (${label(best)}) tiene ${Math.max(0, best.remaining)} kg libres y el paquete pesa ${weight} kg` });
      continue;
    }
    if (trip.remaining != null) trip.remaining = round1(trip.remaining - weight);
    if (!byTrip.has(trip.ref)) byTrip.set(trip.ref, { trip, packages: [] });
    byTrip.get(trip.ref).packages.push({ tracking_code: p.tracking_code, peso: weight, recipient_name: p.recipient_name ?? null });
  }

  // Una propuesta admite hasta MAX_BATCH paquetes: un viaje con más se parte en varios grupos
  const groups = [];
  for (const { trip, packages: list } of byTrip.values()) {
    for (let i = 0; i < list.length; i += MAX_BATCH) {
      const chunk = list.slice(i, i + MAX_BATCH);
      groups.push({
        route_ref: trip.ref, // interno: nunca se muestra
        label: trip.label,
        origin: trip.origin,
        destination: trip.destination,
        departure_time: trip.departure_time,
        vehicle: trip.vehicle ?? null,
        capacity_unknown: trip.free_kg == null,
        free_kg: trip.free_kg ?? null,
        remaining_kg: trip.remaining,
        packages: chunk,
        total_kg: round1(chunk.reduce((n, p) => n + p.peso, 0)),
      });
    }
  }
  groups.sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
  return { groups, unassigned };
};

/** Lee los paquetes sueltos y los viajes planeados y calcula el reparto. La usan la herramienta del agente y los avisos de Logi. */
export const loadAssignmentPlan = async (db, now = Date.now()) => {
  const [loose, routes] = await Promise.all([
    db.from('packages').select('tracking_code, origen, destino, peso, recipient_name, created_at')
      .is('route_id', null).eq('status', 'pendiente').order('created_at', { ascending: true }).limit(MAX_LOOSE),
    db.from('transport_routes').select('id, route_code, origin, destination, status, departure_time, estimated_arrival, vehicle_id')
      .eq('status', 'planeada').gte('departure_time', new Date(now).toISOString()).lte('departure_time', new Date(now + HORIZON_DAYS * DAY_MS).toISOString())
      .order('departure_time', { ascending: true }).limit(MAX_TRIPS),
  ]);
  if (loose.error) throw loose.error;
  if (routes.error) throw routes.error;
  const packages = loose.data || [];
  const trips = packages.length ? await enrichTrips(db, routes.data || []) : [];
  return { packages, ...planAssignments({ packages, trips, now }) };
};

export const buildSuggestionTools = (user, db) => {
  const suggestAssignments = tool(
    async () => {
      try {
        if (!OPS.includes(user.role)) return 'No tienes permiso para consultar esa información.';
        const now = Date.now();
        const { packages, groups, unassigned } = await loadAssignmentPlan(db, now);
        return JSON.stringify({
          kind: 'assignment_suggestions',
          total_loose: packages.length,
          assignable: groups.reduce((n, g) => n + g.packages.length, 0),
          horizon_days: HORIZON_DAYS,
          groups,
          unassigned,
          instruction: 'Es una SUGERENCIA, no se ha asignado nada. Resume cuántos se pueden asignar y cuántos no (y por qué). La pantalla ofrece un botón por viaje para preparar cada asignación, que el usuario debe confirmar.',
        });
      } catch (e) {
        return `No se pudieron calcular las sugerencias: ${e.message}`;
      }
    },
    {
      name: 'suggest_assignments',
      description: 'Revisa los paquetes sueltos (pendientes, sin viaje) y sugiere a qué viaje planeado asignar cada uno: misma ruta, que no haya salido y que quepa. No asigna nada. Solo administradores y operadores. Úsala para "¿qué paquetes sueltos hay?", "sugiere asignaciones" o "¿cómo reparto la carga suelta?".',
      schema: z.object({}),
    },
  );
  return [suggestAssignments];
};
