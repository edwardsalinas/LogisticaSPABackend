-- 020: fecha de entrega de los paquetes.
-- El backend (deliverPackage) y el agente de IA usan packages.delivered_at, que no existía en el esquema.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Paquetes ya entregados: se usa la fecha de creación como aproximación (no hay otro dato disponible).
UPDATE packages SET delivered_at = created_at WHERE status IN ('entregado', 'delivered') AND delivered_at IS NULL;
