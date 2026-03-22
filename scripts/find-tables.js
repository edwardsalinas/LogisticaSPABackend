import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listTables() {
  // query information_schema if possible, or just try common names
  const { data, error } = await supabase.from('packages').select('*').limit(1);
  console.log('Tables check via common names:');
  const common = ['profiles', 'users', 'clients', 'drivers', 'accounts'];
  for (const name of common) {
    const { error } = await supabase.from(name).select('*').limit(1);
    console.log(`Table '${name}': ${error ? 'NOT FOUND (' + error.message + ')' : 'FOUND'}`);
  }
}

listTables();
