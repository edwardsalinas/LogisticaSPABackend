-- FASE 3: Crear tabla de perfiles universal para permitir Joins en el Frontend
-- Esto resuelve el error "Could not find a relationship between 'packages' and 'profiles'"

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Politicas de lectura (todos los autenticados pueden ver perfiles basicos)
CREATE POLICY "Profiles are viewable by authenticated users" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (true);

-- Sincronizar todos los usuarios actuales de Auth a Public.profiles
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

-- Nota: En un entorno productivo real, se usaria un TRIGGER en auth.users
-- Pero para esta fase de correccion, Correr este script sincroniza la base actual.
