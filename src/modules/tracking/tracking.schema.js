import { z } from 'zod';

export const trackingEventSchema = z.object({
  package_id: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90, 'Latitud inválida'),
  lng: z.number().min(-180).max(180, 'Longitud inválida'),
  status: z.string().min(1, 'El estado es requerido'),
});
