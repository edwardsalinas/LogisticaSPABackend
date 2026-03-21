import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  // Intentar listar tablas de forma indirecta o ver si existe tracking_logs
  const { data: tables, error: tableError } = await supabase
    .from('tracking_logs')
    .select('*')
    .limit(1);

  if (tableError) {
    console.error('Error al acceder a tracking_logs:', tableError.message);
  } else {
    console.log('Columnas de tracking_logs:', Object.keys(tables[0] || {}));
  }

  // Verificar driver_trips
  const { data: trips, error: tripError } = await supabase
    .from('driver_trips')
    .select('*')
    .limit(1);

  if (tripError) {
    console.error('Error al acceder a driver_trips:', tripError.message);
  } else {
    console.log('Columnas de driver_trips:', Object.keys(trips[0] || {}));
  }
}

checkSchema();
