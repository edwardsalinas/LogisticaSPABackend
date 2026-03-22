import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from './logistics.schema.js';

/**
 * Registra un nuevo paquete
 */
export const createPackage = async (data, userId) => {
  const { origen, destino, peso, description, route_id } = data;
  
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
        sender_id: userId,
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
  let query = supabase.from('packages').select('*').order('created_at', { ascending: false });
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.sender_id) query = query.eq('sender_id', filters.sender_id);
  const { data, error } = await query;
  if (error) throw error;

  // Mapear nombres de remitentes desde Auth (ya que no hay tabla de profiles para Join)
  try {
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    if (!authError) {
      return data.map(pkg => {
        const user = users.find(u => u.id === pkg.sender_id);
        return {
          ...pkg,
          sender: user ? {
            full_name: user.user_metadata?.full_name || 
                       (user.user_metadata?.first_name 
                         ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`.trim()
                         : user.email)
          } : { full_name: 'Sin Nombre' }
        };
      });
    }
  } catch (err) {
    console.error('[Logistics Service] Error al mapear remitentes:', err);
  }

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
  let query = supabase.from('transport_routes').select('*').order('created_at', { ascending: false });
  
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.driver_id) query = query.eq('driver_id', filters.driver_id);
  
  const { data, error } = await query;
  if (error) throw error;

  // Mapear nombres de choferes desde la tabla 'drivers'
  try {
    const { data: drivers, error: dError } = await supabase.from('drivers').select('id, full_name');
    if (!dError) {
      return data.map(r => {
        const d = drivers.find(drv => drv.id === r.driver_id);
        return {
          ...r,
          driver: d ? { full_name: d.full_name } : null
        };
      });
    }
  } catch (err) {
    console.error('[Logistics Service] Error mapeando conductores en rutas:', err);
  }

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
      console.log(`[Logistics Service] Completando ruta ${pkg.route_id} automáticamente.`);
      await supabase
        .from('transport_routes')
        .update({ status: ROUTE_STATUS.COMPLETED })
        .eq('id', pkg.route_id);
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
      packages (*),
      route_checkpoints (*)
    `)
    .eq('id', routeId)
    .single();

  if (error) throw error;

  // Mapear nombre del conductor
  if (data.driver_id) {
    try {
      const { data: driver, error: dError } = await supabase
        .from('drivers')
        .select('full_name')
        .eq('id', data.driver_id)
        .maybeSingle();
      
      if (!dError && driver) {
        data.driver = driver;
      }
    } catch (err) {
      console.error('[Logistics Service] Error mapeando conductor en ruta:', err);
    }
  }

  // Mapear nombres de remitentes para los paquetes de la ruta
  try {
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    if (!authError && data.packages) {
      data.packages = data.packages.map(pkg => {
        const user = users.find(u => u.id === pkg.sender_id);
        return {
          ...pkg,
          sender: user ? {
            full_name: user.user_metadata?.full_name || 
                       (user.user_metadata?.first_name 
                         ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`.trim()
                         : user.email)
          } : { full_name: 'Sin Nombre' }
        };
      });
    }
  } catch (err) {
    console.error('[Logistics Service] Error al mapear remitentes en ruta:', err);
  }

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
