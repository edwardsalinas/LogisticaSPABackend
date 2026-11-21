-- 018: asegurar que la tabla vehicles tenga las columnas que usa el backend (fleet.schema.js) y el frontend.
-- La tabla se creó originalmente fuera de las migraciones; esta migración es idempotente:
-- no modifica datos existentes y solo agrega lo que falte.

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS capacity_kg NUMERIC;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'disponible';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
