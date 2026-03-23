
import supabase from '../src/shared/config/supabase.js';

async function checkSchema() {
  const { data, error } = await supabase
    .from('driver_trips')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching driver_trips:', error);
    return;
  }

  console.log('Columns in driver_trips:', Object.keys(data[0] || {}));
}

checkSchema();
