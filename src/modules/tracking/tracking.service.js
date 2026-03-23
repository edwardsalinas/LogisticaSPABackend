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
      .select('*, driver:drivers(full_name)')
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

/**
 * Obtiene el historial completo de tracking para una RUTA específica
 */
export const getRouteTracking = async (routeId) => {
  // 1. Encontrar los viajes asociados a esta ruta
  const { data: trips, error: tripsError } = await supabase
    .from('driver_trips')
    .select('id, status, started_at, ended_at')
    .eq('route_id', routeId)
    .order('created_at', { ascending: false });

  if (tripsError) throw tripsError;
  if (!trips || trips.length === 0) return [];

  // 2. Obtener todos los logs de tracking para esos viajes
  const tripIds = trips.map(t => t.id);
  const { data: logs, error: logsError } = await supabase
    .from('tracking_logs')
    .select('*')
    .in('trip_id', tripIds)
    .order('timestamp', { ascending: true });

  if (logsError) throw logsError;

  return logs || [];
};

/**
 * Obtiene información de rastreo pública filtrando datos sensibles
 */
export const getPublicTrackingByCode = async (trackingCode) => {
  // 1. Buscar el paquete por código de rastreo
  const { data: pkg, error: pkgError } = await supabase
    .from('packages')
    .select('id, tracking_code, status, origen, destino, peso, created_at, sender_name, recipient_name')
    .eq('tracking_code', trackingCode)
    .maybeSingle();

  if (pkgError) throw pkgError;
  if (!pkg) return null;

  // 2. Obtener logs asociados (sanitizados: solo status y timestamp)
  const { data: logs, error: logsError } = await supabase
    .from('tracking_logs')
    .select('status, timestamp')
    .eq('package_id', pkg.id)
    .order('timestamp', { ascending: false });

  if (logsError) throw logsError;

  return {
    package: pkg,
    history: logs || []
  };
};
