-- 019: operaciones atómicas (todo o nada) sobre rutas.
--
-- Crear, editar y borrar una ruta implica varias tablas (transport_routes, route_checkpoints, packages,
-- driver_trips, tracking_logs, checkpoint_visits). Hacerlo desde el backend en pasos separados dejaba la
-- base inconsistente si uno fallaba (p. ej. ruta creada sin checkpoints, o checkpoints borrados y no re-creados).
-- Estas funciones ejecutan todo dentro de UNA transacción: si algo falla, no se aplica nada.
--
-- Requiere haber aplicado antes la migración 017 (checkpoint_visits.trip_id).
-- El backend las usa mediante supabase.rpc(); si no están instaladas, usa el flujo secuencial anterior.

-- ---------------------------------------------------------------------------------------------------------
-- Crear ruta + checkpoints
-- p_route: columnas de transport_routes presentes en el JSON (las ausentes toman su valor por defecto)
-- p_checkpoints: [{ name, lat, lng, sequence_order, radius_meters? }]
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_route_with_checkpoints(p_route jsonb, p_checkpoints jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cols  text;
  v_route jsonb;
BEGIN
  -- Solo columnas reales de la tabla (quote_ident evita inyección SQL a través de las claves del JSON)
  SELECT string_agg(quote_ident(c.column_name), ', ')
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'transport_routes'
     AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
     AND p_route ? c.column_name;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'La ruta no contiene columnas válidas' USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'INSERT INTO transport_routes (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::transport_routes, $1) RETURNING to_jsonb(transport_routes)',
    v_cols
  ) INTO v_route USING p_route;

  INSERT INTO route_checkpoints (route_id, name, lat, lng, sequence_order, radius_meters)
  SELECT (v_route ->> 'id')::uuid, cp.name, cp.lat, cp.lng, cp.sequence_order, COALESCE(cp.radius_meters, 100)
    FROM jsonb_to_recordset(COALESCE(p_checkpoints, '[]'::jsonb))
         AS cp(name text, lat double precision, lng double precision, sequence_order int, radius_meters int);

  RETURN v_route;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Actualizar ruta y reemplazar sus checkpoints
-- p_checkpoints NULL = no tocar los checkpoints; '[]' = eliminarlos todos
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_route_with_checkpoints(p_id uuid, p_route jsonb, p_checkpoints jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cols        text;
  v_route       jsonb;
  v_has_updated boolean;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ')
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'transport_routes'
     AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
     AND p_route ? c.column_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'transport_routes' AND column_name = 'updated_at'
  ) INTO v_has_updated;

  IF v_cols IS NOT NULL THEN
    EXECUTE format(
      'UPDATE transport_routes SET (%1$s) = (SELECT %1$s FROM jsonb_populate_record(NULL::transport_routes, $1))%2$s WHERE id = $2 RETURNING to_jsonb(transport_routes)',
      v_cols, CASE WHEN v_has_updated THEN ', updated_at = now()' ELSE '' END
    ) INTO v_route USING p_route, p_id;
  ELSE
    SELECT to_jsonb(r) INTO v_route FROM transport_routes r WHERE r.id = p_id;
  END IF;

  IF v_route IS NULL THEN
    RAISE EXCEPTION 'Ruta no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF p_checkpoints IS NOT NULL AND jsonb_typeof(p_checkpoints) = 'array' THEN
    -- Los checkpoints se reemplazan por completo: sus visitas anteriores pierden sentido
    DELETE FROM checkpoint_visits
     WHERE checkpoint_id IN (SELECT id FROM route_checkpoints WHERE route_id = p_id);
    DELETE FROM route_checkpoints WHERE route_id = p_id;

    INSERT INTO route_checkpoints (route_id, name, lat, lng, sequence_order, radius_meters)
    SELECT p_id, cp.name, cp.lat, cp.lng, cp.sequence_order, COALESCE(cp.radius_meters, 100)
      FROM jsonb_to_recordset(p_checkpoints)
           AS cp(name text, lat double precision, lng double precision, sequence_order int, radius_meters int);
  END IF;

  RETURN v_route;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Eliminar ruta: libera sus paquetes y borra viajes, checkpoints y visitas asociados
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_route_cascade(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_routes WHERE id = p_id) THEN
    RAISE EXCEPTION 'Ruta no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Los paquetes vuelven a "pendiente" (sin ruta)
  UPDATE packages SET route_id = NULL, status = 'pendiente' WHERE route_id = p_id;

  -- Romper la cadena de claves foráneas antes de borrar los viajes
  UPDATE tracking_logs SET trip_id = NULL WHERE trip_id IN (SELECT id FROM driver_trips WHERE route_id = p_id);
  DELETE FROM checkpoint_visits
   WHERE trip_id IN (SELECT id FROM driver_trips WHERE route_id = p_id)
      OR checkpoint_id IN (SELECT id FROM route_checkpoints WHERE route_id = p_id);

  DELETE FROM driver_trips WHERE route_id = p_id;
  DELETE FROM route_checkpoints WHERE route_id = p_id;
  DELETE FROM transport_routes WHERE id = p_id;

  RETURN true;
END;
$$;

-- Estas funciones modifican datos: solo el backend (service_role) puede ejecutarlas.
-- Sin esto, cualquiera con la clave pública (anon) podría invocarlas vía PostgREST.
REVOKE ALL ON FUNCTION public.create_route_with_checkpoints(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_route_with_checkpoints(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_route_cascade(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_route_with_checkpoints(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_route_with_checkpoints(uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_route_cascade(uuid) TO service_role;
