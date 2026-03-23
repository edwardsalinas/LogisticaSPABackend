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
  const { data, error } = await supabase
    .from('driver_trips')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
    })
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('No hay un viaje activo para finalizar (posiblemente ya fue cerrado automáticamente).');
  
  return data;
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
