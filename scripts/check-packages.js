import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  const { data, error } = await supabase.from('packages').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Columnas del paquete:', Object.keys(data[0] || {}));
  }
}

checkSchema();
