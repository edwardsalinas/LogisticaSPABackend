import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDriversSchema() {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error drivers:', error.message);
  } else {
    console.log('Columnas de drivers:', Object.keys(data[0] || {}));
  }
}

checkDriversSchema();
