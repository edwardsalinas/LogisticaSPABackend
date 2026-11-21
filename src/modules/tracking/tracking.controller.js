import { z } from 'zod';
import * as TrackingService from './tracking.service.js';
import { trackingEventSchema } from './tracking.schema.js';
import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import * as PackagesService from '../logistics/packages.service.js';

export const logTrackingEvent = async (req, res) => {
  try {
    const validatedData = trackingEventSchema.parse(req.body);
    
    const result = await TrackingService.logEvent(validatedData, req.user);
    
    // Geofencing: si el paquete tiene ruta, verificar si el punto cae dentro de algún checkpoint
    if (validatedData.package_id) {
      try {
        const pkg = await PackagesService.packagesService.getById(validatedData.package_id);

        if (pkg.route_id) {
          const { data } = await supabase.rpc('check_checkpoint_geofence', {
            p_lat: validatedData.lat,
            p_lng: validatedData.lng,
            p_route_id: pkg.route_id,
          });

          if (data && data.length > 0 && data[0].within_radius) {
            await supabase.from('checkpoint_visits').insert({
              checkpoint_id: data[0].checkpoint_id,
              tracking_log_id: result.id,
              distance_meters: data[0].distance_meters,
              within_radius: true,
            });

            eventBus.publish('tracking:checkpoint_reached', {
              package_id: validatedData.package_id,
              checkpoint_id: data[0].checkpoint_id,
              checkpoint_name: data[0].checkpoint_name,
              distance: data[0].distance_meters,
            });
          }
        }
      } catch (geoError) {
        // No se bloquea la respuesta principal si falla el geofencing
        console.error('[Tracking Controller] Error en geofencing:', geoError);
      }
    }

    return res.status(201).json({
      success: true,
      data: result,
      message: 'Evento de tracking registrado de forma exitosa'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        errors: error.flatten().fieldErrors
      });
    }
    
    console.error('[Tracking Controller] Error logueando evento:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor al procesar el tracking'
    });
  }
};

export const getTrackingLogs = async (req, res) => {
  try {
    const { packageId } = req.params;
    await assertPackageAccess(req.user, packageId);
    const logs = await TrackingService.getLogs(packageId);

    return res.status(200).json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error('[Tracking Controller] Error obteniendo logs:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Error al obtener el historial de tracking',
    });
  }
};

export const handleGetMapData = async (req, res) => {
  try {
    const { packageId } = req.params;
    await assertPackageAccess(req.user, packageId);
    const mapData = await TrackingService.getMapData(packageId);

    return res.status(200).json({
      success: true,
      data: mapData,
    });
  } catch (error) {
    console.error('[Tracking Controller] Error obteniendo datos del mapa:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Error al obtener los datos del mapa de tracking',
    });
  }
};
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distancia en metros
};

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/**
 * Control de propiedad: un cliente solo puede consultar el seguimiento de SUS paquetes.
 * Admin, operador y conductor tienen acceso operativo.
 */
export const assertPackageAccess = async (user, packageId, db = supabase) => {
  if (!user || user.role !== 'client') return;
  const { data, error } = await db.from('packages').select('sender_id').eq('id', packageId).maybeSingle();
  if (error || !data) throw httpError(404, 'Paquete no encontrado');
  if (data.sender_id !== user.id) throw httpError(403, 'No tienes acceso a este paquete');
};

// Registra la visita a un checkpoint. Si la tabla aún no tiene la columna trip_id (migrations/017),
// se registra sin ella para no perder la visita.
const insertCheckpointVisit = async (row) => {
  const result = await supabase.from('checkpoint_visits').insert(row);
  if (result.error && /trip_id/i.test(result.error.message || '')) {
    console.warn('[Tracking] checkpoint_visits sin columna trip_id: aplica migrations/017_checkpoint_visits_trip_id.sql');
    const { trip_id, ...legacy } = row;
    return supabase.from('checkpoint_visits').insert(legacy);
  }
  return result;
};

/**
 * Resuelve el instante real de una lectura GPS. Si el cliente la acumuló offline envía su propio
 * timestamp; se descartan valores inválidos y se limita a "ahora" para evitar fechas futuras.
 */
export const resolveTimestamp = (value) => {
  if (!value) return new Date().toISOString();
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) throw httpError(400, 'timestamp inválido (usa formato ISO 8601)');
  return new Date(Math.min(t, Date.now())).toISOString();
};

/**
 * Procesa un punto GPS de un viaje: detecta partida, checkpoints y llegada al destino,
 * persiste los logs y dispara los eventos de dominio.
 * Es reutilizado por el endpoint individual y por el endpoint por lotes (cola offline).
 */
const processTripEvent = async (tripId, { lat, lng, status, timestamp }, driverId) => {
    const eventTime = resolveTimestamp(timestamp);

    // 1. Viaje (con su ruta); luego paquetes, checkpoints y visitas en paralelo
    const tripResponse = await supabase.from('driver_trips').select('*, transport_routes(*)').eq('id', tripId).single();
    const trip = tripResponse.data;
    if (!trip) throw httpError(404, 'Viaje no encontrado');
    if (driverId && trip.driver_id && trip.driver_id !== driverId) {
      throw httpError(403, 'El viaje no pertenece al conductor autenticado');
    }

    const [packagesResponse, checkpointsResponse, visitsResponse] = await Promise.all([
      supabase.from('packages').select('id').eq('route_id', trip.route_id).neq('status', 'entregado'),
      supabase.from('route_checkpoints').select('*').eq('route_id', trip.route_id).order('sequence_order', { ascending: true }),
      supabase.from('checkpoint_visits').select('checkpoint_id').eq('trip_id', tripId)
    ]);

    
    // Permitimos seguir logueando incluso si el status es 'completed' por latencia,
    // pero enfocamos la lógica en viajes 'active'.
    
    const route = trip.transport_routes;
    const routePackages = packagesResponse.data || [];
    const routeCheckpoints = checkpointsResponse.data || [];
    const visitedIds = new Set((visitsResponse.data || []).map(v => v.checkpoint_id));

    // Determinar el SIGUIENTE checkpoint pendiente (comparando con rc.id que es el checkpoint_id en visits)
    const nextCp = routeCheckpoints.find(rc => !visitedIds.has(rc.id));
    const nextTargetName = nextCp ? nextCp.name : route?.destination;

    // 2. Detección de Hitos de Ciclo de Vida
    let finalStatus = (status === 'in_transit' || !status) 
      ? `En tránsito: ${nextTargetName || 'Destino'}` 
      : status;
    
    let detectedCheckpoint = null;
    let isDestination = false;
    let isDeparture = false;

    // A. Verificar llegada al destino (Prioridad Máxima)
    if (route?.dest_lat && route?.dest_lng) {
      const distToDest = calculateDistance(lat, lng, route.dest_lat, route.dest_lng);
      
      if (distToDest < 1000) { // Reducimos a 1km para mayor precisión en historial
        console.log(`[Tracking] LLEGADA DETECTADA en ${route.destination}`);
        finalStatus = `Llegó al destino: ${route.destination}`;
        isDestination = true;
      }
    }

    // B. Verificar checkpoints (Si no es destino)
    if (!isDestination) {
      const { data: geoData } = await supabase.rpc('check_checkpoint_geofence', { p_lat: lat, p_lng: lng, p_route_id: trip.route_id });
      if (geoData?.length > 0 && geoData[0].within_radius) {
        const cpId = geoData[0].checkpoint_id;
        
        // SOLO si no ha sido visitado ya en este viaje
        if (!visitedIds.has(cpId)) {
          console.log(`[Tracking] Checkpoint NUEVO detectado: ${geoData[0].checkpoint_name}`);
          finalStatus = `Llegó a ${geoData[0].checkpoint_name}`;
          detectedCheckpoint = geoData[0];
        } else {
          // Si ya fue visitado, mantenemos el status de tránsito hacia el SIGUIENTE
          console.log(`[Tracking] Ya en checkpoint (visita previa registrada): ${geoData[0].checkpoint_name}`);
        }
      }
    }

    // C. Verificar si es el primer log (Partida) - Solo si no es destino ni checkpoint específico
    if (!isDestination && !detectedCheckpoint) {
      const { data: departureLogs } = await supabase
        .from('tracking_logs')
        .select('id')
        .eq('trip_id', tripId)
        .ilike('status', 'Inició tránsito%')
        .limit(1);

      if (!departureLogs || departureLogs.length === 0) {
        console.log(`[Tracking] REGISTRANDO PARTIDA para trip ${tripId}`);
        finalStatus = `Inició tránsito desde: ${route?.origin || 'Origen'}`;
        isDeparture = true;
      }
    }

    // 3. Persistencia PARALELA de logs y disparo de eventos
    const { data: mainLog, error: logError } = await supabase
      .from('tracking_logs')
      .insert({ trip_id: tripId, lat, lng, status: finalStatus, timestamp: eventTime, recorded_by: driverId ?? null })
      .select().single();

    if (logError) throw logError;

    const parallelTasks = [];

    // A. Duplicar logs para cada paquete
    if (routePackages.length > 0) {
      const packageLogs = routePackages.map(pkg => ({
        package_id: pkg.id, trip_id: tripId, lat, lng, status: finalStatus, timestamp: eventTime, recorded_by: driverId ?? null
      }));
      parallelTasks.push(supabase.from('tracking_logs').insert(packageLogs));
    }

    // B. Si fue checkpoint, registrar visita y disparar evento
    if (detectedCheckpoint) {
      parallelTasks.push(insertCheckpointVisit({
        trip_id: tripId,
        checkpoint_id: detectedCheckpoint.checkpoint_id,
        tracking_log_id: mainLog.id,
        distance_meters: detectedCheckpoint.distance_meters,
        within_radius: true
      }));
      
      eventBus.publish('tracking:checkpoint_reached', {
        route_id: trip.route_id,
        checkpoint_id: detectedCheckpoint.checkpoint_id,
        checkpoint_name: detectedCheckpoint.checkpoint_name,
        trip_id: tripId, lat, lng
      });
    }

    // C. Si llegó al destino, disparar eventos de entrega y actualizar paquetes
    if (isDestination) {
      console.log(`[Tracking] LLEGADA A DESTINO detectada en ${route.destination}.`);
      
      // 1. Primero registramos la entrega de paquetes y el hito en el historial
      parallelTasks.push(
        supabase.from('packages').update({ status: 'entregado' }).eq('route_id', trip.route_id).neq('status', 'entregado')
      );
      
      routePackages.forEach(pkg => {
        eventBus.publish('tracking:package_delivered', { packageId: pkg.id });
      });

      // 2. Publicamos el evento de llegada ANTES de cerrar el viaje
      eventBus.publish('tracking:checkpoint_reached', {
        route_id: trip.route_id,
        checkpoint_name: `Llegó al destino: ${route.destination}`,
        trip_id: tripId, lat, lng
      });
    }

    // D. Si es partida, actualizar paquetes a 'en_transito'
    if (isDeparture) {
      console.log(`[Tracking] REGISTRANDO PARTIDA para trip ${tripId}`);
      parallelTasks.push(
        supabase.from('packages').update({ status: 'en_transito' }).eq('route_id', trip.route_id).eq('status', 'asignado')
      );
      eventBus.publish('tracking:checkpoint_reached', {
        route_id: trip.route_id,
        checkpoint_name: `Inició tránsito desde: ${route?.origin || 'Origen'}`,
        trip_id: tripId, lat, lng
      });
    }

    // Primero resolvemos logs y eventos (tareas paralelas primarias)
    await Promise.all(parallelTasks);

    // Nota: El cierre de viaje (stop) y ruta (entregado) ahora ocurre de forma 
    // reactiva en el Logistics Service al escuchar 'tracking:package_delivered'
    // para evitar race-conditions en una sola petición.

    return mainLog;
};

export const handleLogTripEvent = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { lat, lng, status, timestamp } = req.body;
    const mainLog = await processTripEvent(tripId, { lat, lng, status, timestamp }, req.user?.id);
    return res.status(201).json({ success: true, data: mainLog });
  } catch (error) {
    console.error('[Tracking Controller] Error logueando evento de viaje:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

const batchSchema = z.object({
  points: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    status: z.string().min(1).optional(),
    timestamp: z.string().datetime({ offset: true }),
  })).min(1).max(200),
});

/**
 * Recibe los puntos GPS que el dispositivo acumuló sin conexión (cola offline).
 * Se procesan en orden cronológico; ante un error se informa cuántos se registraron.
 */
export const handleLogTripEventsBatch = async (req, res) => {
  const { tripId } = req.params;
  let processed = 0;
  try {
    const { points } = batchSchema.parse(req.body);
    const ordered = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let arrived = false; // algún punto del lote marcó la llegada al destino
    for (const point of ordered) {
      const log = await processTripEvent(tripId, point, req.user?.id);
      processed += 1;
      if (/lleg[óo] al destino/i.test(log?.status || '')) arrived = true;
    }
    return res.status(201).json({ success: true, processed, total: ordered.length, arrived });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, processed, errors: error.flatten().fieldErrors });
    }
    console.error('[Tracking Controller] Error en lote de eventos de viaje:', error);
    return res.status(error.status || 500).json({ success: false, processed, message: error.message });
  }
};

export const handleGetRouteTracking = async (req, res) => {
  try {
    const { routeId } = req.params;
    const logs = await TrackingService.getRouteTracking(routeId);
    
    return res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('[Tracking Controller] Error obteniendo historial de ruta:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Endpoint público para rastreo anónimo por código
 */
export const handleGetPublicTracking = async (req, res) => {
  try {
    const { code } = req.params;
    const trackingData = await TrackingService.getPublicTrackingByCode(code);

    if (!trackingData) {
      return res.status(404).json({
        success: false,
        message: 'Código de rastreo no encontrado o inválido'
      });
    }

    return res.status(200).json({
      success: true,
      data: trackingData
    });
  } catch (error) {
    console.error('[Tracking Controller] Error en rastreo público:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud de rastreo'
    });
  }
};
