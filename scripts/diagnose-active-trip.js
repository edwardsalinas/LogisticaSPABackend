import supabase from '../src/shared/config/supabase.js';

const tripId = '48b223fb-e59e-41e6-a912-2ee13c8b414c';

async function diagnose() {
  console.log(`--- Análisis Detallado del Viaje: ${tripId} ---`);
  
  // 1. Datos del Viaje y Ruta
  const { data: trip, error: tripErr } = await supabase
    .from('driver_trips')
    .select('*, transport_routes(*)')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) {
    console.error('Error: No se encontró el viaje o la ruta:', tripErr?.message);
    process.exit(1);
  }

  const route = trip.transport_routes;
  console.log('\n--- DATOS DE RUTA ---');
  console.log(`Origen: ${route.origin} (${route.origin_lat}, ${route.origin_lng})`);
  console.log(`Destino: ${route.destination} (${route.dest_lat}, ${route.dest_lng})`);
  console.log(`Status de Viaje: ${trip.status}`);

  // 2. Datos de Paquetes
  const { data: pkgs, error: pkgErr } = await supabase
    .from('packages')
    .select('id, tracking_code, status, route_id')
    .eq('route_id', trip.route_id);

  console.log('\n--- PAQUETES ASOCIADOS ---');
  if (pkgErr) console.error('Error:', pkgErr.message);
  else console.table(pkgs);

  // 3. Últimos Logs
  const { data: logs, error: logErr } = await supabase
    .from('tracking_logs')
    .select('*')
    .eq('trip_id', tripId)
    .order('timestamp', { ascending: false })
    .limit(5);

  console.log('\n--- ÚLTIMOS 5 LOGS ---');
  if (logErr) console.error('Error:', logErr.message);
  else console.table(logs.map(l => ({
    status: l.status,
    lat: l.lat,
    lng: l.lng,
    time: l.timestamp
  })));

  process.exit(0);
}

diagnose();
