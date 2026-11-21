import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import { PACKAGE_STATUS } from '../logistics/logistics.schema.js';

const normalizeStatus = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '_');

// Estados de un evento manual que también actualizan el estado del paquete (RF02).
// 'entregado' se resuelve por el evento tracking:package_delivered.
const EVENT_TO_PACKAGE_STATUS = {
  en_transito: PACKAGE_STATUS.IN_TRANSIT,
  in_transit: PACKAGE_STATUS.IN_TRANSIT,
  en_agencia: PACKAGE_STATUS.AT_AGENCY,
  at_agency: PACKAGE_STATUS.AT_AGENCY,
  siniestro: PACKAGE_STATUS.INCIDENT,
  incident: PACKAGE_STATUS.INCIDENT,
  devuelto: PACKAGE_STATUS.RETURNED,
};

export const packageStatusFromEvent = (status) => EVENT_TO_PACKAGE_STATUS[normalizeStatus(status)] ?? null;

/**
 * Registra un evento de seguimiento. `user` es el responsable del registro (cadena de custodia, RF03):
 * su id queda guardado en tracking_logs.recorded_by.
 */
export const logEvent = async (data, user = null, db = supabase) => {
  const { package_id, lat, lng, status, observations } = data;

  const { data: insertedData, error } = await db
    .from('tracking_logs')
    .insert([
      {
        package_id,
        lat,
        lng,
        status,
        observations: observations ?? null,
        recorded_by: user?.id ?? null,
        timestamp: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    throw error;
  }

  const newPackageStatus = packageStatusFromEvent(status);
  if (package_id && newPackageStatus) {
    const { error: updateError } = await db.from('packages').update({ status: newPackageStatus }).eq('id', package_id);
    if (updateError) console.error('[Tracking] No se pudo actualizar el estado del paquete:', updateError.message);
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
        .order('sequence_order', { ascending: true });

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
/**
 * Enmascara un nombre para el rastreo público: "Juan Pérez" -> "J*** P****".
 * El código de seguimiento no es un secreto fuerte, así que no se expone el nombre completo.
 */
export const maskName = (name) => {
  if (!name || typeof name !== 'string') return name;
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : w[0] + '*'.repeat(Math.min(w.length - 1, 5))))
    .join(' ');
};

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
    package: {
      ...pkg,
      sender_name: maskName(pkg.sender_name),
      recipient_name: maskName(pkg.recipient_name),
    },
    history: logs || []
  };
};
