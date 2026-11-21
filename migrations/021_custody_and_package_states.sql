-- 021: cadena de custodia (RF03) y estados de paquete del requerimiento RF02.
--
-- 1) tracking_logs.recorded_by: usuario responsable de registrar cada estado/evento.
--    Es NULL en los registros anteriores (no se puede reconstruir quién los registró) y en los
--    eventos que no tienen un usuario asociado.
-- 2) packages.status: se amplía la restricción con 'en_agencia' y 'siniestro' (RF02) y con 'cancelado',
--    que el backend ya usaba pero la restricción anterior rechazaba (solo permitía 'devuelto').
--    Es un superconjunto de los valores anteriores: no invalida ninguna fila existente.

ALTER TABLE tracking_logs
  ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_logs_recorded_by ON tracking_logs(recorded_by);

ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages
  ADD CONSTRAINT packages_status_check
  CHECK (status IN ('pendiente', 'asignado', 'en_transito', 'en_agencia', 'entregado', 'siniestro', 'devuelto', 'cancelado'));
