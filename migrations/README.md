# Migraciones SQL

Se aplican **en orden alfabético del nombre de archivo** (en el editor SQL de Supabase o con `psql`). Son idempotentes
(`IF NOT EXISTS`, `CREATE OR REPLACE`), de modo que volver a ejecutar una no daña los datos.

| Archivo | Propósito |
|---|---|
| `002_predefined_routes_and_trips` | Rutas predefinidas y viajes de conductores |
| `003_add_trip_id_to_tracking` | Vincula `tracking_logs` con los viajes |
| `004_assign_test_route_to_driver` | Datos de prueba (solo desarrollo) |
| `005_add_coords_to_routes` | Coordenadas en `transport_routes` |
| `006_make_package_id_nullable` | Tracking sin paquete asociado |
| `007_sync_drivers_and_vehicles` | Columnas y sincronización de conductores y vehículos |
| `008_deduplicate_predefined_routes` | Limpieza de rutas predefinidas duplicadas |
| `009_create_comprehensive_profiles_table` | Tabla `profiles` |
| `010_link_routes_to_drivers` | Clave foránea ruta → conductor |
| `011_create_fleet_schedules` | Cronogramas (`schedules`) |
| `012_add_guest_and_recipient_fields` | Remitente invitado y destinatario en `packages` |
| `012_update_schedules_jsonb` | `day_times` en formato JSONB |
| `013_add_missing_schedule_columns` | Columnas faltantes de `schedules` |
| `014_automated_profile_sync` | Trigger de sincronización de `profiles` |
| `014_fix_tracking_logs_integrity` | Integridad de `tracking_logs` |
| `015_add_performance_fks` | Claves foráneas e índices de rendimiento |
| `016_add_ping_count_to_trips` | Contador de pings en `driver_trips` |
| `017_checkpoint_visits_trip_id` | Vincula las visitas a checkpoints con el viaje |
| `018_ensure_vehicles_columns` | Garantiza las columnas de `vehicles` que usa el backend |
| `019_route_atomic_operations` | Funciones SQL atómicas para crear, editar y borrar rutas |
| `020_packages_delivered_at` | Columna `delivered_at` de `packages` (fecha de entrega) |

## Archivos con el mismo número (`012` y `014`)

Los pares `012_*` y `014_*` **son independientes**: cada uno toca tablas distintas
(`012`: `packages` y `schedules`; `014`: `profiles` y `tracking_logs`). Por eso el orden alfabético entre ellos es
indiferente. Se mantienen los nombres originales para no desalinear bases de datos donde ya se aplicaron;
las migraciones nuevas continúan desde el `017`.

## Notas

- `019` requiere haber aplicado antes `017` (usa `checkpoint_visits.trip_id`).
- `019` restringe la ejecución de sus funciones al rol `service_role` (el backend). Si las funciones no están
  instaladas, el backend sigue funcionando con el flujo secuencial anterior (sin transacción) y lo avisa en el log.
- `004` inserta datos de prueba: no es necesaria en producción.
