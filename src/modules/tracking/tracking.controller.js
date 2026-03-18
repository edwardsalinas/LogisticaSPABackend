import { z } from 'zod';
import * as TrackingService from './tracking.service.js';

const trackingEventSchema = z.object({
  package_id: z.string().min(1, 'El ID del paquete es requerido'),
  lat: z.number().min(-90).max(90, 'Latitud inválida'),
  lng: z.number().min(-180).max(180, 'Longitud inválida'),
  status: z.string().min(1, 'El estado es requerido'),
});

export const logTrackingEvent = async (req, res) => {
  try {
    const validatedData = trackingEventSchema.parse(req.body);
    
    const result = await TrackingService.logEvent(validatedData);
    
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
