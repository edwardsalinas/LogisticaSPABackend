-- ============================================
-- Migration: Predefined Routes & Driver Trips
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Rutas predefinidas (pares de ciudades con coordenadas)
CREATE TABLE IF NOT EXISTS predefined_routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  origin_city TEXT NOT NULL,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lng DOUBLE PRECISION NOT NULL,
  destination_city TEXT NOT NULL,
  dest_lat DOUBLE PRECISION NOT NULL,
  dest_lng DOUBLE PRECISION NOT NULL,
  estimated_km NUMERIC,
  estimated_minutes INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Sesiones de viaje de conductores
CREATE TABLE IF NOT EXISTS driver_trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  route_id UUID REFERENCES transport_routes(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para buscar viajes activos rápidamente
CREATE INDEX IF NOT EXISTS idx_driver_trips_active 
  ON driver_trips (driver_id, status) 
  WHERE status = 'active';

-- 3. Seed: Rutas predefinidas de Bolivia
INSERT INTO predefined_routes (name, origin_city, origin_lat, origin_lng, destination_city, dest_lat, dest_lng, estimated_km, estimated_minutes) VALUES
  ('La Paz → Oruro', 'La Paz', -16.5000, -68.1193, 'Oruro', -17.9833, -67.1500, 230, 210),
  ('Oruro → La Paz', 'Oruro', -17.9833, -67.1500, 'La Paz', -16.5000, -68.1193, 230, 210),
  ('Santa Cruz → Cochabamba', 'Santa Cruz', -17.7833, -63.1821, 'Cochabamba', -17.3901, -66.18339, 480, 420),
  ('Cochabamba → Santa Cruz', 'Cochabamba', -17.3901, -66.18339, 'Santa Cruz', -17.7833, -63.1821, 480, 420),
  ('Sucre → Potosí', 'Sucre', -19.0333, -65.2627, 'Potosí', -19.5836, -65.7531, 160, 180),
  ('Potosí → Sucre', 'Potosí', -19.5836, -65.7531, 'Sucre', -19.0333, -65.2627, 160, 180),
  ('Cochabamba → La Paz', 'Cochabamba', -17.3901, -66.18339, 'La Paz', -16.5000, -68.1193, 380, 420),
  ('La Paz → Cochabamba', 'La Paz', -16.5000, -68.1193, 'Cochabamba', -17.3901, -66.18339, 380, 420),
  ('Santa Cruz → La Paz', 'Santa Cruz', -17.7833, -63.1821, 'La Paz', -16.5000, -68.1193, 880, 960),
  ('La Paz → Santa Cruz', 'La Paz', -16.5000, -68.1193, 'Santa Cruz', -17.7833, -63.1821, 880, 960)
ON CONFLICT DO NOTHING;

-- 3.5 Actualización forzada para Cochabamba (asegura que registros antiguos se actualicen)
UPDATE predefined_routes 
SET dest_lat = -17.3901, dest_lng = -66.18339 
WHERE destination_city = 'Cochabamba';

UPDATE predefined_routes 
SET origin_lat = -17.3901, origin_lng = -66.18339 
WHERE origin_city = 'Cochabamba';

-- 4. RLS (Row Level Security) - Ajustar según necesidad
ALTER TABLE predefined_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predefined_routes_select_all" ON predefined_routes;
CREATE POLICY "predefined_routes_select_all" ON predefined_routes FOR SELECT USING (true);

ALTER TABLE driver_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_trips_all_service_role" ON driver_trips;
CREATE POLICY "driver_trips_all_service_role" ON driver_trips FOR ALL USING (true);
