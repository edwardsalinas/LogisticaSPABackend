import { z } from 'zod';

export const PACKAGE_STATUS = {
  PENDING: 'pendiente',
  ASSIGNED: 'asignado',
  IN_TRANSIT: 'en_tránsito',
  DELIVERED: 'entregado',
  CANCELLED: 'cancelado',
};

export const ROUTE_STATUS = {
  PLANNED: 'planificada',
  ACTIVE: 'activa',
  COMPLETED: 'completada',
};

export const packageSchema = z.object({
  origen: z.string().min(3, 'Origen es requerido (mín. 3 caracteres)'),
  destino: z.string().min(3, 'Destino es requerido (mín. 3 caracteres)'),
  peso: z.number().positive('El peso debe ser un número positivo'),
  description: z.string().optional(),
});

export const routeSchema = z.object({
  driver_id: z.string().uuid('driver_id debe ser un UUID válido'),
  vehicle_id: z.string().uuid('vehicle_id debe ser un UUID válido'),
  origin_city: z.string().min(2, 'Ciudad de origen es requerida'),
  destination_city: z.string().min(2, 'Ciudad de destino es requerida'),
  departure_date: z.string().datetime({ message: 'Fecha de salida inválida (ISO 8601)' }),
});

export const assignmentSchema = z.object({
  package_id: z.string().uuid('package_id debe ser un UUID válido'),
  route_id: z.string().uuid('route_id debe ser un UUID válido'),
});
