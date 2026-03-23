import { z } from 'zod';
import * as TrackingService from './tracking.service.js';
import { trackingEventSchema } from './tracking.schema.js';
import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import * as PackagesService from '../logistics/packages.service.js';

export const logTrackingEvent = async (req, res) => {
  try {
    const validatedData = trackingEventSchema.parse(req.body);
    
    const result = await TrackingService.logEvent(validatedData);
    
    // === AGREGAR ESTO DESPUÉS DE CREAR EL TRACKING LOG ===
    try {
      // Obtener el paquete para saber su ruta
      const { packagesService } = await import('../logistics/packages.service.js');
      const pkg = await packagesService.getById(validatedData.package_id);

      // Si tiene ruta, verificar geofencing
      if (pkg.route_id) {
        const { default: supabase } = await import('../../shared/config/supabase.js');

        const { data, error } = await supabase.rpc('check_checkpoint_geofence', {
          p_lat: validatedData.lat,
          p_lng: validatedData.lng,
          p_route_id: pkg.route_id,
        });

        if (data && data.length > 0 && data[0].within_radius) {
          // Registrar visita al checkpoint
          await supabase
            .from('checkpoint_visits')
            .insert({
              checkpoint_id: data[0].checkpoint_id,
              tracking_log_id: result.id,
              distance_meters: data[0].distance_meters,
              within_radius: true,
            });

          // Publicar evento para notificaciones
          const { default: eventBus } = await import('../../shared/utils/eventBus.js');
          eventBus.publish('tracking:checkpoint_reached', {
            package_id: validatedData.package_id,
            checkpoint_id: data[0].checkpoint_id,
            checkpoint_name: data[0].checkpoint_name,
            distance: data[0].distance_meters,
          });
        }
      }
    } catch (geoError) {
      console.error('[Tracking Controller] Error en geofencing:', geoError);
      // No bloqueamos la respuesta principal si falla el geofencing
    }
    // === FIN DEL CÓDIGO A AGREGAR ===

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
    const logs = await TrackingService.getLogs(packageId);

    return res.status(200).json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error('[Tracking Controller] Error obteniendo logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el historial de tracking',
    });
  }
};

export const handleGetMapData = async (req, res) => {
  try {
    const { packageId } = req.params;
    const mapData = await TrackingService.getMapData(packageId);

    return res.status(200).json({
      success: true,
      data: mapData,
    });
  } catch (error) {
    console.error('[Tracking Controller] Error obteniendo datos del mapa:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener los datos del mapa de tracking',
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

export const handleLogTripEvent = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { lat, lng, status } = req.body;
    
    // 1. Obtención paralela de viaje y paquetes no entregados
    const [tripResponse, packagesResponse] = await Promise.all([
      supabase.from('driver_trips').select('*, transport_routes(*)').eq('id', tripId).single(),
      supabase.from('packages').select('id').eq('route_id', (await supabase.from('driver_trips').select('route_id').eq('id', tripId).single()).data?.route_id).neq('status', 'entregado')
    ]);

    const trip = tripResponse.data;
    if (!trip) throw new Error('Viaje no encontrado');
    
    // Permitimos seguir logueando incluso si el status es 'completed' por latencia,
    // pero enfocamos la lógica en viajes 'active'.
    
    const route = trip.transport_routes;
    const routePackages = packagesResponse.data || [];

    // 2. Detección de Hitos de Ciclo de Vida
    let finalStatus = status || 'in_transit';
    let detectedCheckpoint = null;
    let isDestination = false;
    let isDeparture = false;

    // A. Verificar llegada al destino (Prioridad Máxima)
    if (route?.dest_lat && route?.dest_lng) {
      const distToDest = calculateDistance(lat, lng, route.dest_lat, route.dest_lng);
      console.log(`[Tracking] Trip: ${tripId} | Distancia a La Paz: ${Math.round(distToDest)}m`);
      
      if (distToDest < 5000) {
        console.log(`[Tracking] LLEGADA DETECTADA en ${route.destination}`);
        finalStatus = `Llegó al destino: ${route.destination}`;
        isDestination = true;
      }
    }

    // B. Verificar checkpoints (Si no es destino)
    if (!isDestination) {
      const { data: geoData } = await supabase.rpc('check_checkpoint_geofence', { p_lat: lat, p_lng: lng, p_route_id: trip.route_id });
      if (geoData?.length > 0 && geoData[0].within_radius) {
        console.log(`[Tracking] Checkpoint detectado: ${geoData[0].checkpoint_name}`);
        finalStatus = `Llegó a ${geoData[0].checkpoint_name}`;
        detectedCheckpoint = geoData[0];
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
      .insert({ trip_id: tripId, lat, lng, status: finalStatus, timestamp: new Date().toISOString() })
      .select().single();

    if (logError) throw logError;

    const parallelTasks = [];

    // A. Duplicar logs para cada paquete
    if (routePackages.length > 0) {
      const packageLogs = routePackages.map(pkg => ({
        package_id: pkg.id, trip_id: tripId, lat, lng, status: finalStatus, timestamp: new Date().toISOString()
      }));
      parallelTasks.push(supabase.from('tracking_logs').insert(packageLogs));
    }

    // B. Si fue checkpoint, registrar visita y disparar evento
    if (detectedCheckpoint) {
      parallelTasks.push(supabase.from('checkpoint_visits').insert({
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

    return res.status(201).json({ success: true, data: mainLog });
  } catch (error) {
    console.error('[Tracking Controller] Error logueando evento de viaje:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
