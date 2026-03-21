-- Agregar columnas de coordenadas a transport_routes si no existen
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS origin_lat DOUBLE PRECISION;
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS origin_lng DOUBLE PRECISION;
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS dest_lat DOUBLE PRECISION;
ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS dest_lng DOUBLE PRECISION;

-- Asegurar que route_code sea único si se usa
-- ALTER TABLE transport_routes ADD CONSTRAINT unique_route_code UNIQUE (route_code);
