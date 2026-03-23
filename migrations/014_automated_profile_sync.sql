-- Phase 13: Automated Profile Sync Trigger
-- This ensures public.profiles is always in sync with auth.users

-- 1. Create Profiles table (if not exists)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Read Policy
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are viewable by authenticated users" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (true);

-- 4. Sync Function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    COALESCE(new.raw_user_meta_data->>'role', 'authenticated')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    updated_at = NOW();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Trigger (Auth Sync)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Bulk Initial Sync (Populate from existing users)
INSERT INTO public.profiles (id, full_name, email, role, created_at)
SELECT 
    id, 
    COALESCE(raw_user_meta_data->>'full_name', email) as full_name,
    email,
    raw_user_meta_data->>'role' as role,
    created_at
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    updated_at = NOW();
