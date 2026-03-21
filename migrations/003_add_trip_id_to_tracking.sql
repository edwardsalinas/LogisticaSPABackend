-- Agregar trip_id a tracking_logs para vincular eventos de GPS a viajes específicos de conductores
ALTER TABLE tracking_logs ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES driver_trips(id);

-- Índice para mejorar la búsqueda de eventos por viaje
CREATE INDEX IF NOT EXISTS idx_tracking_logs_trip_id ON tracking_logs(trip_id);

-- Función para que el cliente pueda ver la ubicación actual de un paquete basada en el viaje activo de su ruta
-- Esta lógica se manejará principalmente en el servicio de Node.js, pero aseguramos que las tablas estén listas.
