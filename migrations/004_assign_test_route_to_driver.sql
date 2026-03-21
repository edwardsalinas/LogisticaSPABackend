-- 1. Encontrar el ID del conductor de prueba
-- (Se asume que ya existe por el script de seed-users.js)
DO $$
DECLARE
    v_driver_id UUID;
    v_route_id UUID;
BEGIN
    -- Obtener el ID del driver
    SELECT id INTO v_driver_id FROM auth.users WHERE email = 'driver@logistica.bo';

    IF v_driver_id IS NULL THEN
        RAISE NOTICE 'No se encontró el usuario driver@logistica.bo. Asegúrate de haber corrido el script de seed.';
    ELSE
        -- 2. Crear una ruta de prueba asignada a este conductor
        INSERT INTO transport_routes (
            origin, 
            destination, 
            departure_time, 
            status, 
            driver_id,
            route_code
        ) VALUES (
            'La Paz', 
            'Cochabamba', 
            NOW() + interval '1 day', 
            'planeada', 
            v_driver_id,
            'TEST-ROUTE-001'
        ) RETURNING id INTO v_route_id;

        -- 3. Asignar un paquete de prueba a esta ruta
        -- (Buscamos el primer paquete pendiente o creamos uno)
        UPDATE packages 
        SET route_id = v_route_id, 
            status = 'asignado'
        WHERE id IN (SELECT id FROM packages WHERE status = 'pendiente' LIMIT 1);

        RAISE NOTICE 'Ruta asignada con éxito al driver.';
    END IF;
END $$;
