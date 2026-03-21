-- 1. Asegurar que la tabla drivers tenga las columnas necesarias
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='full_name') THEN
        ALTER TABLE drivers ADD COLUMN full_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='email') THEN
        ALTER TABLE drivers ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='phone') THEN
        ALTER TABLE drivers ADD COLUMN phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='license_number') THEN
        ALTER TABLE drivers ADD COLUMN license_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='status') THEN
        ALTER TABLE drivers ADD COLUMN status TEXT DEFAULT 'active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='created_at') THEN
        ALTER TABLE drivers ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2. Sincronizar conductores desde la tabla de usuarios de Supabase
-- Usamos COALESCE agresivo para evitar errores de NOT NULL si el usuario no tiene metadata
INSERT INTO public.drivers (id, full_name, email, phone, license_number, status, created_at)
SELECT 
    id, 
    COALESCE(raw_user_meta_data->>'full_name', email, 'Conductor ' || SUBSTRING(id::TEXT FROM 1 FOR 5)) as full_name,
    COALESCE(email, 'driver@logistica.bo') as email,
    COALESCE(raw_user_meta_data->>'phone', 'S/N') as phone,
    COALESCE(raw_user_meta_data->>'license_number', 'S/L-' || SUBSTRING(id::TEXT FROM 1 FOR 8)) as license_number,
    'active' as status,
    now() as created_at
FROM auth.users
WHERE raw_user_meta_data->>'role' = 'driver'
ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    license_number = EXCLUDED.license_number;

-- 3. Corregir/Asegurar columnas en vehicles
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicles' AND column_name='brand') THEN
        ALTER TABLE vehicles ADD COLUMN brand TEXT;
    END IF;
END $$;

-- Actualizar marcas si están nulas para que no se vea "undefined" en el frontend
UPDATE vehicles SET brand = 'Volvo' WHERE model ILIKE '%FH16%' AND brand IS NULL;
UPDATE vehicles SET brand = 'Mercedes' WHERE model ILIKE '%Sprinter%' AND brand IS NULL;
UPDATE vehicles SET brand = 'Isuzu' WHERE model ILIKE '%Forward%' AND brand IS NULL;
UPDATE vehicles SET brand = 'Vehículo' WHERE brand IS NULL; 
