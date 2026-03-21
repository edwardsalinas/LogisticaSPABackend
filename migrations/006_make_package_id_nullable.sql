-- Permitir que package_id sea opcional en tracking_logs
-- Esto es necesario porque ahora los eventos pueden estar vinculados a un trip_id (viaje del chofer) 
-- que abarca múltiples paquetes simultáneamente.

ALTER TABLE tracking_logs ALTER COLUMN package_id DROP NOT NULL;
