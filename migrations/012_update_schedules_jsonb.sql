-- =============================================
-- Migration: Update schedules to use JSONB day_times
-- =============================================

-- 1. Agregar columna day_times
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS day_times JSONB DEFAULT '{}'::jsonb;

-- 2. Eliminar columnas antiguas que ya no se usan con el nuevo formato
ALTER TABLE schedules DROP COLUMN IF EXISTS day_of_week;
ALTER TABLE schedules DROP COLUMN IF EXISTS departure_time;
