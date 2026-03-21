-- ============================================
-- Migration: Deduplicate and Constrain Predefined Routes
-- ============================================

-- 1. Eliminar duplicados manteniendo solo la versión más reciente por nombre
DELETE FROM public.predefined_routes
WHERE id NOT IN (
    SELECT id
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at DESC) as row_num
        FROM public.predefined_routes
    ) t
    WHERE t.row_num = 1
);

-- 2. Añadir restricción de unicidad al nombre para evitar futuros duplicados
ALTER TABLE public.predefined_routes 
ADD CONSTRAINT predefined_routes_name_key UNIQUE (name);

-- Comentario
COMMENT ON CONSTRAINT predefined_routes_name_key ON public.predefined_routes IS 'Evita rutas predefinidas con el mismo nombre';
