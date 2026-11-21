-- 017: vincular las visitas a checkpoints con el viaje (driver_trips).
-- El backend consulta checkpoint_visits por trip_id para saber qué checkpoints ya se visitaron
-- en el viaje actual y evitar registrar la misma visita en cada ping GPS.

ALTER TABLE checkpoint_visits
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES driver_trips(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_trip_id ON checkpoint_visits(trip_id);
