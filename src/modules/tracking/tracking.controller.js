import { z } from 'zod';
import * as TrackingService from './tracking.service.js';
import { trackingEventSchema } from './tracking.schema.js';
import supabase from '../../shared/config/supabase.js';

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
    
    console.log(`[Tracking Controller] Reporte de viaje recibido: Trip=${tripId}, Lat=${lat}, Lng=${lng}`);

    // 1. Obtener los detalles del viaje y su ruta relacionada
    const { data: trip } = await supabase
      .from('driver_trips')
      .select('*, transport_routes(*)')
      .eq('id', tripId)
      .single();

    if (!trip) {
      console.error(`[Tracking Controller] Trip ${tripId} no encontrado en DB`);
      throw new Error('Viaje no encontrado');
    }

    const route = trip.transport_routes;
    if (!route) {
       console.warn(`[Tracking Controller] Trip ${tripId} no tiene una ruta (transport_routes) asociada`);
    }

    // 1.5 Obtener paquetes de esta ruta (para eventos y logs duplicados)
    const { data: routePackages } = await supabase
      .from('packages')
      .select('id')
      .eq('route_id', trip.route_id);

    // 2. Determinar el estado final basado en Geofencing
    let finalStatus = status || 'in_transit';
    let detectedCheckpoint = null;

    // 2.1 Verificar llegada al destino final
    if (route && route.dest_lat && route.dest_lng) {
      const distanceToDest = calculateDistance(lat, lng, route.dest_lat, route.dest_lng);
      if (distanceToDest < 200) {
        finalStatus = `Llegó al destino: ${route.destination}`;
        
        // Disparar eventos de entrega
        if (routePackages && routePackages.length > 0) {
          const { default: eventBus } = await import('../../shared/utils/eventBus.js');
          for (const pkg of routePackages) {
            eventBus.publish('tracking:package_delivered', { packageId: pkg.id });
          }
        }
      } else {
        // 2.2 Verificar Checkpoints Intermedios
        try {
          const { data: geoData } = await supabase.rpc('check_checkpoint_geofence', {
            p_lat: lat,
            p_lng: lng,
            p_route_id: trip.route_id,
          });

          if (geoData && geoData.length > 0 && geoData[0].within_radius) {
            finalStatus = `Llegó a ${geoData[0].checkpoint_name}`;
            detectedCheckpoint = geoData[0];
          }
        } catch (geoError) {
          console.error('[Tracking Controller] Error en geofencing:', geoError);
        }
      }
    }

    // 3. Registrar log de tracking para el VIAJE con el estado final determinado
    const { data: log, error: logError } = await supabase
      .from('tracking_logs')
      .insert({
        trip_id: tripId,
        lat,
        lng,
        status: finalStatus,
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (logError) throw logError;

    // 4. DUPLICAR Log para cada paquete de la ruta con el estado final
    if (routePackages && routePackages.length > 0) {
      const packageLogs = routePackages.map(pkg => ({
        package_id: pkg.id,
        trip_id: tripId,
        lat,
        lng,
        status: finalStatus,
        timestamp: new Date().toISOString()
      }));

      await supabase.from('tracking_logs').insert(packageLogs);
    }

    // 5. Si fue un checkpoint, registrar la visita y publicar evento
    if (detectedCheckpoint) {
      // Registrar visita vinculada al log principal
      await supabase
        .from('checkpoint_visits')
        .insert({
          checkpoint_id: detectedCheckpoint.checkpoint_id,
          tracking_log_id: log.id,
          distance_meters: detectedCheckpoint.distance_meters,
          within_radius: true,
        });

      // Notificar al sistema
      const { default: eventBus } = await import('../../shared/utils/eventBus.js');
      eventBus.publish('tracking:checkpoint_reached', {
        route_id: trip.route_id,
        checkpoint_id: detectedCheckpoint.checkpoint_id,
        checkpoint_name: detectedCheckpoint.checkpoint_name,
        trip_id: tripId,
        lat,
        lng
      });
    }

    return res.status(201).json({ success: true, data: log });
    return res.status(201).json({ success: true, data: log });
  } catch (error) {
    console.error('[Tracking Controller] Error logueando evento de viaje:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
