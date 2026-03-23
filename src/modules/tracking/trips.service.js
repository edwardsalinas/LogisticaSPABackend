import supabase from '../../shared/config/supabase.js';

/**
 * Servicio para gestionar sesiones de viaje de conductores.
 * Permite iniciar/detener viajes para control de tracking GPS.
 */

/**
 * Inicia un nuevo viaje para el conductor
 */
export const startTrip = async (driverId, routeId) => {
  // Verificar que no haya un viaje activo
  const { data: existing } = await supabase
    .from('driver_trips')
    .select('id')
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    throw new Error('Ya existe un viaje activo. Finalícelo antes de iniciar uno nuevo.');
  }

  const { data, error } = await supabase
    .from('driver_trips')
    .insert({
      driver_id: driverId,
      route_id: routeId || null,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // Al iniciar el viaje, marcar todos los paquetes de esta ruta como "en_transito"
  // Y actualizar el estado de la ruta propia
  if (routeId) {
    await Promise.all([
      supabase
        .from('packages')
        .update({ status: 'en_transito' }) 
        .eq('route_id', routeId)
        .eq('status', 'asignado'),
      supabase
        .from('transport_routes')
        .update({ status: 'en_transito' })
        .eq('id', routeId)
    ]);
  }

  return data;
};

/**
 * Detiene el viaje activo del conductor
 */
export const stopTrip = async (driverId) => {
  // 1. Buscar el viaje activo actual
  const { data: trip, error: fetchError } = await supabase
    .from('driver_trips')
    .select('id, route_id')
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (fetchError) throw fetchError;
  
  if (!trip) {
    // Si no hay viaje activo, devolver éxito pero indicar que ya estaba cerrado
    return { success: true, message: 'No habia un viaje activo para cerrar' };
  }

  // 2. Ejecutar actualizaciones en paralelo: El viaje y la ruta asociada
  const [tripUpdate] = await Promise.all([
    supabase
      .from('driver_trips')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
      })
      .eq('id', trip.id)
      .select()
      .single(),
    
    trip.route_id ? supabase
      .from('transport_routes')
      .update({ status: 'completada' })
      .eq('id', trip.route_id) : Promise.resolve()
  ]);

  if (tripUpdate.error) throw tripUpdate.error;
  return tripUpdate.data;
};

/**
 * Obtiene el viaje activo del conductor (si existe)
 */
export const getActiveTrip = async (driverId) => {
  const { data, error } = await supabase
    .from('driver_trips')
    .select('*, transport_routes(*)')
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
};
