import { z } from 'zod';

export const VEHICLE_STATUS = {
  AVAILABLE: 'disponible',
  IN_SERVICE: 'en_servicio',
  MAINTENANCE: 'mantenimiento',
  RETIRED: 'retirado',
};

export const vehicleSchema = z.object({
  plate: z.string().min(6, 'La placa debe tener al menos 6 caracteres').max(10, 'Placa demasiado larga'),
  model: z.string().min(2, 'El modelo es requerido'),
  type: z.string().min(2, 'El tipo de vehículo es requerido'),
  capacity_kg: z.number().positive('La capacidad debe ser positiva'),
  status: z.nativeEnum(VEHICLE_STATUS).default(VEHICLE_STATUS.AVAILABLE),
});

export const driverSchema = z.object({
  license_number: z.string().min(5, 'Número de licencia inválido'),
  phone: z.string().min(7, 'Número de teléfono inválido'),
  current_vehicle_id: z.string().uuid().optional(),
});

export const scheduleSchema = z.object({
  predefined_route_id: z.string().uuid('ID de ruta inválido').optional().nullable(),
  driver_id: z.string().uuid('ID de chofer inválido').optional().nullable(),
  vehicle_id: z.string().uuid('ID de vehículo inválido').optional().nullable(),
  origin: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  origin_lat: z.number().optional().nullable(),
  origin_lng: z.number().optional().nullable(),
  dest_lat: z.number().optional().nullable(),
  dest_lng: z.number().optional().nullable(),
  day_times: z.record(z.string().regex(/^[0-6]$/), z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, 'Formato de hora inválido (HH:mm)')),
  is_active: z.boolean().default(true),
});
