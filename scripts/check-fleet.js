import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFleetSchema() {
  // Verificar vehículos
  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select('*')
    .limit(1);

  if (vError) {
    console.error('Error vehicles:', vError.message);
  } else {
    console.log('Columnas de vehicles:', Object.keys(vehicles[0] || {}));
  }

  // Verificar perfiles (conductores)
  const { data: profiles, error: pError } = await supabase
    .from('profiles')
    .select('*')
    .limit(1);

  if (pError) {
    console.error('Error profiles:', pError.message);
  } else {
    console.log('Columnas de profiles:', Object.keys(profiles[0] || {}));
  }
}

checkFleetSchema();
