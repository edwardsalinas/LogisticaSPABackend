import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from './logistics.schema.js';

/**
 * Registra un nuevo paquete
 */
export const createPackage = async (data, userId) => {
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
        tracking_code: `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      }
    ])
    .select()
    .single();

  if (error) throw error;
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
export const createRoute = async (data) => {
  const { checkpoints, ...routeData } = data;

  const { data: route, error } = await supabase
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

    const { error: cpError } = await supabase
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
export const assignPackageToRoute = async (packageId, routeId) => {
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
export const updateRoute = async (id, data) => {
  const { checkpoints, ...routeData } = data;

  // 1. Actualizar datos básicos de la ruta
  const { data: updated, error } = await supabase
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
    await supabase
      .from('route_checkpoints')
      .delete()
      .eq('route_id', id);

    // Luego insertamos los nuevos
    if (checkpoints.length > 0) {
      const checkpointsToInsert = checkpoints.map(cp => ({
        ...cp,
        route_id: id
      }));

      const { error: cpError } = await supabase
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
export const deleteRoute = async (id) => {
  // 1. Obtener IDs de viajes asociados a esta ruta
  const { data: trips } = await supabase
    .from('driver_trips')
    .select('id')
    .eq('route_id', id);
  
  const tripIds = trips?.map(t => t.id) || [];

  // 2. Desasignar paquetes (volver a PENDING)
  await supabase
    .from('packages')
    .update({ route_id: null, status: PACKAGE_STATUS.PENDING })
    .eq('route_id', id);

  // 3. Limpiar tracking_logs para romper la cadena de FK
  if (tripIds.length > 0) {
    await supabase
      .from('tracking_logs')
      .update({ trip_id: null })
      .in('trip_id', tripIds);
  }

  // 4. Eliminar sesiones de viaje (driver_trips)
  await supabase
    .from('driver_trips')
    .delete()
    .eq('route_id', id);

  // 5. Eliminar checkpoints
  await supabase
    .from('route_checkpoints')
    .delete()
    .eq('route_id', id);

  // 6. Eliminar la ruta
  const { error } = await supabase
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
export const deliverPackage = async (packageId) => {
  const { data: pkg, error: fetchError } = await supabase
    .from('packages')
    .select('id, status, route_id')
    .eq('id', packageId)
    .single();

  if (fetchError) throw fetchError;
  if (pkg.status === PACKAGE_STATUS.DELIVERED) return pkg;

  const { data: updated, error } = await supabase
    .from('packages')
    .update({ 
      status: PACKAGE_STATUS.DELIVERED,
      delivered_at: new Date().toISOString()
    })
    .eq('id', packageId)
    .select()
    .single();

  if (error) throw error;

  // Emitir evento para automatizaciones (como cerrar la ruta si es el último paquete)
  eventBus.emit('tracking:package_delivered', { packageId });

  return updated;
};
