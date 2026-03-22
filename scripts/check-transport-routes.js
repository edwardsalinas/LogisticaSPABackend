import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTransportRoutes() {
  console.log('Checking transport_routes table...');
  const { data: raw, error: rawError } = await supabase.from('transport_routes').select('*').limit(1);
  if (rawError) {
    console.error('Error fetching transport_routes:', rawError.message);
  } else {
    console.log('Sample row data:', raw?.[0]);
  }
}

checkTransportRoutes();
