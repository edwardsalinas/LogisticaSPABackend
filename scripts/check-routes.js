import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRoutesSchema() {
  const { data, error } = await supabase.from('transport_routes').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Columnas de transport_routes:', Object.keys(data[0] || {}));
  }
}

checkRoutesSchema();
