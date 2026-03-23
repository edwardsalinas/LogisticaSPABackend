
-- Agregar columna ping_count a driver_trips para seguimiento en tiempo real
ALTER TABLE driver_trips ADD COLUMN IF NOT EXISTS ping_count INTEGER DEFAULT 0;

-- Asegurar que los registros existentes tengan 0
UPDATE driver_trips SET ping_count = 0 WHERE ping_count IS NULL;
