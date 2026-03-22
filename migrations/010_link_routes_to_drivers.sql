-- FASE 3: Vincular transport_routes con la tabla de drivers (public.drivers)
-- Esto permite que PostgREST realice el Join automatico para obtener nombres de choferes

-- 1. Asegurar que driver_id en transport_routes sea del mismo tipo que en drivers (UUID)
-- (Ya lo es, pero lo reforzamos si fuera necesario)

-- 2. Añadir la Constraint de Foreign Key si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_transport_routes_driver') THEN
        ALTER TABLE public.transport_routes 
        ADD CONSTRAINT fk_transport_routes_driver 
        FOREIGN KEY (driver_id) REFERENCES public.drivers(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Si hay registros que apuntan a usuarios que NO estan en la tabla drivers (ej: borrados),
-- esto podria fallar. Pero como drivers se sincroniza de auth.users, deberia estar bien.
-- Nota: Si falla por integridad, habria que correr primero la sincronizacion de drivers (007).
