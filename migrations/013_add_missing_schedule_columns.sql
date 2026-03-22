-- =============================================
-- Migration: Add missing columns to schedules
-- =============================================

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS origin_lat DECIMAL(9,6);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS origin_lng DECIMAL(9,6);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS dest_lat DECIMAL(9,6);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS dest_lng DECIMAL(9,6);

-- Hacer route_id opcional por si se usa trazo manual
ALTER TABLE schedules ALTER COLUMN route_id DROP NOT NULL;

-- Rename route_id to predefined_route_id for consistency with existing code
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedules' AND column_name = 'route_id') THEN
    ALTER TABLE schedules RENAME COLUMN route_id TO predefined_route_id;
  END IF;
END $$;
