-- =============================================
-- Migration 014: Fix Tracking Logs Integrity
-- =============================================

-- 1. Fix the type mismatch for package_id in tracking_logs
-- First, identify any rows that can't be converted to UUID (optional but safe)
-- Then perform the conversion
ALTER TABLE public.tracking_logs 
  ALTER COLUMN package_id TYPE uuid USING (
    CASE 
      WHEN package_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
      THEN package_id::uuid 
      ELSE NULL 
    END
  );

-- 2. Clean up invalid package_ids (e.g., placeholders like all-zeros) 
-- that don't exist in the 'packages' table to avoid FK violations.
UPDATE public.tracking_logs
SET package_id = NULL
WHERE package_id IS NOT NULL 
  AND package_id NOT IN (SELECT id FROM public.packages);

-- 3. Add Foreign Key constraint for package_id
ALTER TABLE public.tracking_logs
  ADD CONSTRAINT tracking_logs_package_id_fkey 
  FOREIGN KEY (package_id) REFERENCES public.packages(id)
  ON DELETE SET NULL;

-- 3. Add index for performance on package tracking
CREATE INDEX IF NOT EXISTS idx_tracking_logs_package_id ON public.tracking_logs(package_id);

-- 4. Unify 'schedules' and 'vehicle_schedules'
-- If vehicle_schedules exists, ensure it has the same structure as schedules
-- Currently both have predefined_route_id, driver_id, and vehicle_id.
-- Let's add 'label' to schedules to match vehicle_schedules functionality.
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS label TEXT;

-- 5. Documentation Comment
COMMENT ON COLUMN public.tracking_logs.trip_id IS 'Vincula este log de GPS a una sesión de viaje específica de un conductor.';
