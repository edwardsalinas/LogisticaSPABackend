import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';

export const logEvent = async (data) => {
  const { package_id, lat, lng, status } = data;

  const { data: insertedData, error } = await supabase
    .from('tracking_logs')
    .insert([
      {
        package_id,
        lat,
        lng,
        status,
        timestamp: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    throw error;
  }

  if (status.toLowerCase() === 'delivered' || status.toLowerCase() === 'entregado') {
    eventBus.publish('tracking:package_delivered', { packageId: package_id });
  } else {
    eventBus.publish('tracking:event_registered', { packageId: package_id, status });
  }

  return insertedData[0];
};

export const getLogs = async (packageId) => {
  const { data, error } = await supabase
    .from('tracking_logs')
    .select('*')
    .eq('package_id', packageId)
    .order('timestamp', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Obtiene todos los datos necesarios para el mapa de tracking
 */
export const getMapData = async (packageId) => {
  // 1. Obtener el paquete
  const { data: pkg, error: pkgError } = await supabase
    .from('packages')
    .select('*')
    .eq('id', packageId)
    .single();

  if (pkgError) throw pkgError;

  let route = null;
  let checkpoints = [];

  // 2. Si el paquete tiene ruta, obtener ruta y checkpoints
  if (pkg.route_id) {
    const { data: routeData, error: routeError } = await supabase
      .from('transport_routes')
      .select('*')
      .eq('id', pkg.route_id)
      .single();

    if (!routeError) {
      route = routeData;

      const { data: cpData, error: cpError } = await supabase
        .from('route_checkpoints')
        .select('*')
        .eq('route_id', pkg.route_id)
        .order('order_index', { ascending: true });

      if (!cpError) {
        checkpoints = cpData;
      }
    }
  }

  // 3. Buscar si hay un viaje ACTIVO para la ruta de este paquete
  let active_trip = null;
  let current_position = null;

  if (pkg.route_id) {
    const { data: tripData } = await supabase
      .from('driver_trips')
      .select('*, driver:profiles(full_name)')
      .eq('route_id', pkg.route_id)
      .eq('status', 'active')
      .maybeSingle();

    if (tripData) {
      active_trip = tripData;

      // Obtener la última posición registrada para este VIAJE
      const { data: lastLog } = await supabase
        .from('tracking_logs')
        .select('*')
        .eq('trip_id', tripData.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastLog) {
        current_position = {
          lat: lastLog.lat,
          lng: lastLog.lng,
          timestamp: lastLog.timestamp
        };
      }
    }
  }

  // 4. Obtener logs de tracking específicos del PAQUETE
  const logs = await getLogs(packageId);

  return {
    package: pkg,
    route,
    checkpoints,
    active_trip,
    current_position,
    tracking_logs: logs
  };
};
