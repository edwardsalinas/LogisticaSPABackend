-- =============================================
-- Migration: Fleet Schedules (Cronogramas)
-- =============================================

-- 1. Tabla de Cronogramas
CREATE TABLE IF NOT EXISTS schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES predefined_routes(id),
  driver_id UUID REFERENCES drivers(id),
  vehicle_id UUID REFERENCES vehicles(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Dom, 1=Lun, ..., 6=Sab
  departure_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indice para búsqueda eficiente por dia de la semana
CREATE INDEX IF NOT EXISTS idx_schedules_active_day 
ON schedules (is_active, day_of_week);

-- 2. Modificar transport_routes para rastrear origen de cronograma
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id);
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- 3. Índice único para prevenir duplicados en la generación
-- Evita que se genere la misma ruta del mismo cronograma para la misma fecha
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_routes_schedule_date 
ON transport_routes (schedule_id, scheduled_date) 
WHERE schedule_id IS NOT NULL;

-- 4. RLS para schedules
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedules_select_all" ON schedules;
CREATE POLICY "schedules_select_all" ON schedules FOR SELECT USING (true);

DROP POLICY IF EXISTS "schedules_all_admin" ON schedules;
CREATE POLICY "schedules_all_admin" ON schedules FOR ALL USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);
