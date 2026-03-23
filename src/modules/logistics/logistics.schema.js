import { z } from 'zod';

export const PACKAGE_STATUS = {
  PENDING: 'pendiente',
  ASSIGNED: 'asignado',
  IN_TRANSIT: 'en_transito',
  DELIVERED: 'entregado',
  CANCELLED: 'cancelado',
};

export const ROUTE_STATUS = {
  PLANNED: 'planeada',
  ACTIVE: 'en_transito',
  COMPLETED: 'completada',
};
export const packageSchema = z.object({
  origen: z.string().min(3, 'Origen es requerido (mín. 3 caracteres)'),
  destino: z.string().min(3, 'Destino es requerido (mín. 3 caracteres)'),
  peso: z.number().positive('El peso debe ser un número positivo'),
  description: z.string().optional(),
  route_id: z.string().uuid('route_id debe ser un UUID válido').nullish(),
  sender_id: z.string().uuid('sender_id debe ser un UUID válido').optional().nullable(),
  sender_name: z.string().optional(),
  sender_phone: z.string().optional(),
  recipient_name: z.string().min(3, 'Nombre del destinatario es requerido'),
  recipient_phone: z.string().optional(),
  recipient_email: z.string().email('Email inválido').optional().or(z.literal('')),
});

export const routeSchema = z.object({
  driver_id: z.string().uuid('driver_id debe ser un UUID válido').optional(),
  vehicle_id: z.string().uuid('vehicle_id debe ser un UUID válido').optional(),
  origin: z.string().min(2, 'Ciudad de origen es requerida'),
  destination: z.string().min(2, 'Ciudad de destino es requerida'),
  origin_lat: z.number().optional(),
  origin_lng: z.number().optional(),
  dest_lat: z.number().optional(),
  dest_lng: z.number().optional(),
  route_code: z.string().optional(),
  departure_time: z.string().datetime({ message: 'Fecha de salida inválida (ISO 8601)' }),
  checkpoints: z.array(z.object({
    name: z.string().min(2),
    lat: z.number(),
    lng: z.number(),
    sequence_order: z.number().int()
  })).optional(),
}).refine((data) => {
  const now = new Date();
  const depTime = new Date(data.departure_time);
  // Permitimos un margen de 5 minutos por discrepancias de reloj
  return depTime > new Date(now.getTime() - 5 * 60000);
}, {
  message: "La fecha de salida no puede estar en el pasado",
  path: ["departure_time"]
});

export const assignmentSchema = z.object({
  package_id: z.string().uuid('package_id debe ser un UUID válido'),
  route_id: z.string().uuid('route_id debe ser un UUID válido'),
});
