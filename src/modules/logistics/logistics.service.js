import supabase from '../../shared/config/supabase.js';
import { randomBytes } from 'node:crypto';
import eventBus from '../../shared/utils/eventBus.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from './logistics.schema.js';

/**
 * Registra un nuevo paquete
 */
// Código de seguimiento: marca de tiempo + 32 bits aleatorios criptográficos (antes: Math.random, predecible)
export const generateTrackingCode = () => `TRK-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Posición para el evento de custodia de un paquete que aún no tiene GPS: el origen de su viaje, o la ciudad de
 * origen (tabla de rutas predefinidas). Si no hay ninguna, (0, 0), igual que la entrega (tracking_logs exige coordenadas).
 */
export const custodyLocation = async (pkg, db = supabase) => {
  if (pkg.route_id) {
    const { data: route } = await db.from('transport_routes').select('origin_lat, origin_lng').eq('id', pkg.route_id).maybeSingle();
    if (route && isNum(route.origin_lat) && isNum(route.origin_lng)) return { lat: route.origin_lat, lng: route.origin_lng };
  }
  const { data: asOrigin } = await db.from('predefined_routes').select('origin_lat, origin_lng').eq('origin_city', pkg.origen).limit(1).maybeSingle();
  if (asOrigin && isNum(asOrigin.origin_lat) && isNum(asOrigin.origin_lng)) return { lat: asOrigin.origin_lat, lng: asOrigin.origin_lng };
  const { data: asDest } = await db.from('predefined_routes').select('dest_lat, dest_lng').eq('destination_city', pkg.origen).limit(1).maybeSingle();
  if (asDest && isNum(asDest.dest_lat) && isNum(asDest.dest_lng)) return { lat: asDest.dest_lat, lng: asDest.dest_lng };
  return { lat: 0, lng: 0 };
};

/**
 * Cadena de custodia (RF03): deja en el historial QUIÉN registró o asignó el paquete y cuándo. Devuelve el error si
 * no se pudo escribir, para que quien llama revierta el cambio (sin constancia no hay cambio).
 */
export const recordCustodyEvent = async ({ pkg, status, actor, observations = null, db = supabase }) => {
  const position = await custodyLocation(pkg, db);
  const { error } = await db.from('tracking_logs').insert({
    package_id: pkg.id,
    lat: position.lat,
    lng: position.lng,
    status,
    observations,
    recorded_by: actor?.id ?? null,
    timestamp: new Date().toISOString(),
  });
  return error ?? null;
};

export const createPackage = async (data, userId, { actor = null } = {}) => {
  const { 
    origen, destino, peso, description, route_id,
    sender_id, sender_name, sender_phone,
    recipient_name, recipient_phone, recipient_email 
  } = data;
  
  let initialStatus = PACKAGE_STATUS.PENDING;
  
  if (route_id) {
    const { data: activeTrip } = await supabase
      .from('driver_trips')
      .select('id')
      .eq('route_id', route_id)
      .eq('status', 'active')
      .maybeSingle();
      
    initialStatus = activeTrip ? PACKAGE_STATUS.IN_TRANSIT : PACKAGE_STATUS.ASSIGNED;
  }
  
  const { data: inserted, error } = await supabase
    .from('packages')
    .insert([
      {
        sender_id: sender_id || userId || null,
        sender_name,
        sender_phone,
        recipient_name,
        recipient_phone,
        recipient_email,
        origen,
        destino,
        peso,
        description,
        route_id: route_id || null,
        status: initialStatus,
        tracking_code: generateTrackingCode()
      }
    ])
    .select()
    .single();

  if (error) throw error;

  // Primer eslabón de la cadena de custodia: quién registró el paquete. Sin constancia no se deja el paquete creado.
  const custodyError = await recordCustodyEvent({ pkg: inserted, status: 'Pendiente', actor: actor ?? { id: userId } });
  if (custodyError) {
    await supabase.from('packages').delete().eq('id', inserted.id);
    throw custodyError;
  }
  if (route_id) {
    const assignedError = await recordCustodyEvent({ pkg: inserted, status: initialStatus === PACKAGE_STATUS.IN_TRANSIT ? 'En tránsito' : 'Asignado', actor: actor ?? { id: userId } });
    if (assignedError) console.error('[Logistics] No se pudo registrar la asignación inicial:', assignedError.message);
  }
  return inserted;
};

/**
 * Lista todos los paquetes (con filtros opcionales)
 */
export const getPackages = async (filters = {}) => {
  const { page = 1, limit = 50 } = filters;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('packages')
    .select('*, sender:profiles(full_name), transport_routes(departure_time)')
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.sender_id) query = query.eq('sender_id', filters.sender_id);
  
  // Aplicar paginación del servidor
  query = query.range(from, to);

  const { data, error } = await query;
  if (error) throw error;

  return data;
};

/**
 * Crea una nueva ruta de transporte
 */
const createRouteSequential = async (data, db = supabase) => {
  const { checkpoints, ...routeData } = data;

  const { data: route, error } = await db
    .from('transport_routes')
    .insert([
      {
        ...routeData,
        status: ROUTE_STATUS.PLANNED
      }
    ])
    .select()
    .single();

  if (error) throw error;

  // Insertar checkpoints si vienen en el payload
  if (checkpoints && checkpoints.length > 0) {
    const checkpointsToInsert = checkpoints.map(cp => ({
      ...cp,
      route_id: route.id
    }));

    const { error: cpError } = await db
      .from('route_checkpoints')
      .insert(checkpointsToInsert);

    if (cpError) {
      console.error('[Logistics Service] Error insertando checkpoints:', cpError);
    }
  }

  return route;
};

/**
 * Lista todas las rutas de transporte (con filtros opcionales)
 */
export const getRoutes = async (filters = {}) => {
  let query = supabase
    .from('transport_routes')
    .select('*, driver:drivers(full_name)')
    .order('created_at', { ascending: false });
  
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.driver_id) query = query.eq('driver_id', filters.driver_id);
  
  const { data, error } = await query;
  if (error) throw error;

  return data;
};

/**
 * Asigna un paquete a una ruta
 */
export const assignPackageToRoute = async (packageId, routeId, { actor = null } = {}) => {
  const { data: before } = await supabase.from('packages').select('route_id, status').eq('id', packageId).maybeSingle();
  const { data: activeTrip } = await supabase
    .from('driver_trips')
    .select('id')
    .eq('route_id', routeId)
    .eq('status', 'active')
    .maybeSingle();

  const newStatus = activeTrip ? PACKAGE_STATUS.IN_TRANSIT : PACKAGE_STATUS.ASSIGNED;

  const { data: updated, error } = await supabase
    .from('packages')
    .update({ 
      route_id: routeId, 
      status: newStatus 
    })
    .eq('id', packageId)
    .select()
    .single();

  if (error) throw error;

  // Segundo eslabón: quién asignó el paquete al viaje. Sin constancia se deshace la asignación.
  const custodyError = await recordCustodyEvent({ pkg: updated, status: newStatus === PACKAGE_STATUS.IN_TRANSIT ? 'En tránsito' : 'Asignado', actor, observations: 'Asignado al viaje' });
  if (custodyError) {
    await supabase.from('packages').update({ route_id: before?.route_id ?? null, status: before?.status ?? PACKAGE_STATUS.PENDING }).eq('id', packageId);
    throw custodyError;
  }
  return updated;
};

/**
 * Deshace una asignación: el paquete vuelve a «pendiente» y sin viaje. Solo mientras siga «asignado» y su viaje no haya
 * salido (un paquete en tránsito, entregado o de un viaje en curso ya no se puede devolver). Queda constancia de quién lo
 * deshizo, igual que al asignar.
 */
export const unassignPackageFromRoute = async (packageId, { actor = null, db = supabase } = {}) => {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const { data: pkg } = await db.from('packages').select('*').eq('id', packageId).maybeSingle();
  if (!pkg) throw fail(404, 'No se encontró el paquete.');
  if (pkg.status !== PACKAGE_STATUS.ASSIGNED || !pkg.route_id) {
    throw fail(409, 'Solo se puede deshacer la asignación de un paquete que sigue «asignado» a un viaje.');
  }
  const { data: route } = await db.from('transport_routes').select('status').eq('id', pkg.route_id).maybeSingle();
  if (route && route.status !== 'planeada') throw fail(409, 'El viaje ya salió: el paquete no se puede devolver a pendientes.');

  const { data: updated, error } = await db.from('packages').update({ route_id: null, status: PACKAGE_STATUS.PENDING }).eq('id', packageId).select().single();
  if (error) throw error;

  const custodyError = await recordCustodyEvent({ pkg: updated, status: 'Pendiente', actor, observations: 'Asignación deshecha', db });
  if (custodyError) {
    await db.from('packages').update({ route_id: pkg.route_id, status: pkg.status }).eq('id', packageId);
    throw custodyError;
  }
  return updated;
};

/**
 * Automatización: Escuchar entrega de paquetes
 */
eventBus.subscribe('tracking:package_delivered', async ({ packageId }) => {
  console.log(`[Logistics Service] Paquete entregado detectado: ${packageId}`);
  
  try {
    const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .update({ status: PACKAGE_STATUS.DELIVERED })
      .eq('id', packageId)
      .select('route_id')
      .single();

    if (pkgError || !pkg.route_id) return;

    const { data: remaining, error: checkError } = await supabase
      .from('packages')
      .select('id')
      .eq('route_id', pkg.route_id)
      .neq('status', PACKAGE_STATUS.DELIVERED);

    if (checkError) throw checkError;

    if (remaining.length === 0) {
      console.log(`[Logistics Service] Todos los paquetes de la ruta ${pkg.route_id} marcados como entregados. Esperando cierre manual o via Dashboard del conductor.`);
      // La finalización de la ruta y el viaje ahora es responsabilidad del Cliente (Dashboard)
      // al recibir la confirmación de llegada, para asegurar sincronía total de eventos.
    }
  } catch (err) {
    console.error(`[Logistics Service] Error en automatización:`, err);
  }
});

/**
 * Obtiene los detalles de una ruta y sus paquetes asignados
 */
export const getRoute = async (routeId) => {
  const { data, error } = await supabase
    .from('transport_routes')
    .select(`
      *,
      driver:drivers(full_name),
      packages (*, sender:profiles(full_name)),
      route_checkpoints (*)
    `)
    .eq('id', routeId)
    .single();

  if (error) throw error;

  return {
    ...data,
    checkpoints: data.route_checkpoints?.sort((a, b) => a.sequence_order - b.sequence_order) || []
  };
};

/**
 * Actualiza una ruta de transporte y sus checkpoints
 */
const updateRouteSequential = async (id, data, db = supabase) => {
  const { checkpoints, ...routeData } = data;

  // 1. Actualizar datos básicos de la ruta
  const { data: updated, error } = await db
    .from('transport_routes')
    .update({
      ...routeData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // 2. Gestionar checkpoints (Eliminar existentes y re-insertar)
  // Nota: Esto es más simple que hacer un diff, dado que son pocos puntos.
  if (checkpoints) {
    // Primero eliminamos los viejos
    await db
      .from('route_checkpoints')
      .delete()
      .eq('route_id', id);

    // Luego insertamos los nuevos
    if (checkpoints.length > 0) {
      const checkpointsToInsert = checkpoints.map(cp => ({
        ...cp,
        route_id: id
      }));

      const { error: cpError } = await db
        .from('route_checkpoints')
        .insert(checkpointsToInsert);

      if (cpError) {
        console.error('[Logistics Service] Error actualizando checkpoints:', cpError);
      }
    }
  }

  return updated;
};

/**
 * Elimina una ruta de transporte
 */
const deleteRouteSequential = async (id, db = supabase) => {
  // 1. Obtener IDs de viajes asociados a esta ruta
  const { data: trips } = await db
    .from('driver_trips')
    .select('id')
    .eq('route_id', id);
  
  const tripIds = trips?.map(t => t.id) || [];

  // 2. Desasignar paquetes (volver a PENDING)
  await db
    .from('packages')
    .update({ route_id: null, status: PACKAGE_STATUS.PENDING })
    .eq('route_id', id);

  // 3. Limpiar tracking_logs para romper la cadena de FK
  if (tripIds.length > 0) {
    await db
      .from('tracking_logs')
      .update({ trip_id: null })
      .in('trip_id', tripIds);
  }

  // 4. Eliminar sesiones de viaje (driver_trips)
  await db
    .from('driver_trips')
    .delete()
    .eq('route_id', id);

  // 5. Eliminar checkpoints
  await db
    .from('route_checkpoints')
    .delete()
    .eq('route_id', id);

  // 6. Eliminar la ruta
  const { error } = await db
    .from('transport_routes')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
};

/**
 * Lista las rutas predefinidas activas
 */
export const getPredefinedRoutes = async () => {
  const { data, error } = await supabase
    .from('predefined_routes')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
};
/**
 * Marca un paquete como entregado
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Confirma la entrega de un paquete (HU02).
 * - Un conductor solo puede entregar paquetes de SUS rutas (admin y operador, cualquiera).
 * - Deja constancia en el historial (tracking_logs) con el responsable y la nota opcional (RF03).
 */
export const deliverPackage = async (packageId, { user = null, note = null, lat = null, lng = null } = {}, db = supabase) => {
  const { data: pkg, error: fetchError } = await db
    .from('packages')
    .select('id, status, route_id')
    .eq('id', packageId)
    .single();

  if (fetchError) throw fetchError;
  if (pkg.status === PACKAGE_STATUS.DELIVERED) return pkg;
  if ([PACKAGE_STATUS.CANCELLED, PACKAGE_STATUS.RETURNED].includes(pkg.status)) {
    throw httpError(409, 'El paquete está cancelado o devuelto y no puede entregarse');
  }

  let route = null;
  if (pkg.route_id) {
    const { data } = await db.from('transport_routes').select('driver_id, dest_lat, dest_lng').eq('id', pkg.route_id).maybeSingle();
    route = data;
  }

  if (user?.role === 'driver' && (!route || route.driver_id !== user.id)) {
    throw httpError(403, 'Este paquete no pertenece a una de tus rutas');
  }

  // Ubicación de la entrega: la reportada, o el destino de la ruta; tracking_logs exige coordenadas.
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const position = isNum(lat) && isNum(lng)
    ? { lat, lng }
    : isNum(route?.dest_lat) && isNum(route?.dest_lng) ? { lat: route.dest_lat, lng: route.dest_lng } : { lat: 0, lng: 0 };

  const deliveredAt = new Date().toISOString();
  const { data: updated, error } = await db
    .from('packages')
    .update({ status: PACKAGE_STATUS.DELIVERED, delivered_at: deliveredAt })
    .eq('id', packageId)
    .select()
    .single();

  if (error) throw error;

  const { error: logError } = await db.from('tracking_logs').insert({
    package_id: packageId,
    lat: position.lat,
    lng: position.lng,
    status: 'Entregado',
    observations: note || null,
    recorded_by: user?.id ?? null,
    timestamp: deliveredAt,
  });

  if (logError) {
    // Sin constancia en el historial no se considera entregado: se revierte el estado
    await db.from('packages').update({ status: pkg.status, delivered_at: null }).eq('id', packageId);
    throw logError;
  }

  // Emitir evento para automatizaciones (como cerrar la ruta si es el último paquete)
  eventBus.emit('tracking:package_delivered', { packageId });

  return updated;
};

// ---------------------------------------------------------------------------------------------------------
// Operaciones atómicas sobre rutas (migrations/019_route_atomic_operations.sql)
//
// Crear, editar y borrar una ruta toca varias tablas. Se ejecutan como funciones SQL (RPC) dentro de una
// transacción: o se aplica todo o no se aplica nada. Si las funciones aún no están instaladas en la base,
// se usa el flujo secuencial anterior (sin transacción) y se avisa en el log.
// ---------------------------------------------------------------------------------------------------------
const isMissingFunction = (error) =>
  ['PGRST202', '42883'].includes(error?.code) || /could not find the function/i.test(error?.message || '');

let warnedNoAtomic = false;
const warnNoAtomic = () => {
  if (warnedNoAtomic) return;
  warnedNoAtomic = true;
  console.warn('[Logistics] Funciones atómicas de rutas no instaladas (migrations/019_route_atomic_operations.sql): se usa el flujo secuencial, sin transacción.');
};

/**
 * Completa distancia, duración y llegada estimada de una ruta a partir del tramo predefinido (predefined_routes)
 * que coincide con su origen y destino. Sin tramo conocido (ruta dibujada en el mapa) no se inventa nada.
 * Sin llegada estimada no se puede medir si una entrega fue "a tiempo" (página Analítica).
 */
export const withEstimates = async (data, db = supabase) => {
  if (!data.origin || !data.destination || !data.departure_time) return data;
  if (data.estimated_duration_minutes != null && data.estimated_arrival != null) return data;

  const { data: tramo } = await db
    .from('predefined_routes')
    .select('estimated_km, estimated_minutes')
    .eq('origin_city', data.origin)
    .eq('destination_city', data.destination)
    .limit(1)
    .maybeSingle();

  const minutes = Number(tramo?.estimated_minutes);
  const departure = new Date(data.departure_time).getTime();
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(departure)) return data;

  return {
    ...data,
    total_distance_km: data.total_distance_km ?? tramo.estimated_km ?? null,
    estimated_duration_minutes: minutes,
    estimated_arrival: new Date(departure + minutes * 60000).toISOString(),
  };
};

export const createRoute = async (rawData, db = supabase) => {
  const data = await withEstimates(rawData, db);
  const { checkpoints, ...routeData } = data;
  const { data: route, error } = await db.rpc('create_route_with_checkpoints', {
    p_route: { ...routeData, status: ROUTE_STATUS.PLANNED },
    p_checkpoints: checkpoints || [],
  });
  if (!error) return route;
  if (!isMissingFunction(error)) throw error;
  warnNoAtomic();
  return createRouteSequential(data, db);
};

export const updateRoute = async (id, rawData, db = supabase) => {
  const data = await withEstimates(rawData, db);
  const { checkpoints, ...routeData } = data;
  const { data: route, error } = await db.rpc('update_route_with_checkpoints', {
    p_id: id,
    p_route: routeData,
    p_checkpoints: checkpoints ?? null, // null = no tocar los checkpoints
  });
  if (!error) return route;
  if (!isMissingFunction(error)) throw error;
  warnNoAtomic();
  return updateRouteSequential(id, data, db);
};

export const deleteRoute = async (id, db = supabase) => {
  const { error } = await db.rpc('delete_route_cascade', { p_id: id });
  if (!error) return true;
  if (!isMissingFunction(error)) throw error;
  warnNoAtomic();
  return deleteRouteSequential(id, db);
};
