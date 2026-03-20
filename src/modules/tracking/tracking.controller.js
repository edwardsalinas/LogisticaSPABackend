import { z } from 'zod';
import * as TrackingService from './tracking.service.js';
import { trackingEventSchema } from './tracking.schema.js';

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

