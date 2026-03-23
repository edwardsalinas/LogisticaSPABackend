import supabase from '../src/shared/config/supabase.js';

async function debugLlegada() {
  console.log('--- Buscando Rutas a La Paz ---');
  const { data: routes, error } = await supabase
    .from('transport_routes')
    .select('id, origin, destination, dest_lat, dest_lng')
    .ilike('destination', '%La Paz%');

  if (error) {
    console.error('Error fetching routes:', error.message);
    process.exit(1);
  }

  console.table(routes);

  console.log('\n--- Buscando Paquetes en Tránsito ---');
  const { data: pkgs, error: pkgError } = await supabase
    .from('packages')
    .select('id, tracking_code, status, route_id')
    .eq('status', 'en_transito');

  if (pkgError) {
    console.error('Error fetching packages:', pkgError.message);
    process.exit(1);
  }

  console.table(pkgs);
  process.exit(0);
}

debugLlegada();
