-- Phase 13 Maintenance: Add explicit FKs for Relational Joins
-- This enables the ".select('*, profiles(*)')" syntax in Supabase

-- 1. Link Packages to Profiles
-- First, ensure all sender_ids exist in profiles (they should due to previous sync, but just in case)
ALTER TABLE IF EXISTS public.packages 
DROP CONSTRAINT IF EXISTS fk_packages_profiles;

ALTER TABLE public.packages 
ADD CONSTRAINT fk_packages_profiles 
FOREIGN KEY (sender_id) 
REFERENCES public.profiles(id) 
ON DELETE SET NULL;

-- 2. Link Transport Routes to Drivers
ALTER TABLE IF EXISTS public.transport_routes 
DROP CONSTRAINT IF EXISTS fk_routes_drivers;

ALTER TABLE public.transport_routes 
ADD CONSTRAINT fk_routes_drivers 
FOREIGN KEY (driver_id) 
REFERENCES public.drivers(id) 
ON DELETE SET NULL;

-- 3. Optimization: Add Indexes for these Joins
CREATE INDEX IF NOT EXISTS idx_packages_sender_id ON public.packages(sender_id);
CREATE INDEX IF NOT EXISTS idx_transport_routes_driver_id ON public.transport_routes(driver_id);
