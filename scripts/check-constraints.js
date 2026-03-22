import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFKs() {
  console.log('Checking packages table...');
  const { data: raw, error: rawError } = await supabase.from('packages').select('*').limit(1);
  if (rawError) {
    console.error('Error fetching packages:', rawError.message);
  } else {
    console.log('Sample row columns:', Object.keys(raw?.[0] || {}));
    console.log('Sample row data:', raw?.[0]);
  }

  console.log('\nChecking profiles table...');
  const { data: prof, error: profError } = await supabase.from('profiles').select('*').limit(1);
  if (profError) {
    console.error('Error fetching profiles:', profError.message);
  } else {
    console.log('Profiles table exists.');
  }
}

checkFKs();
