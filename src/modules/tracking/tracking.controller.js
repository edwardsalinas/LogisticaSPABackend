import { z } from 'zod';
import * as TrackingService from './tracking.service.js';
import { trackingEventSchema } from './tracking.schema.js';

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

