
import supabase from '../src/shared/config/supabase.js';

async function checkRouteCheckpointsSchema() {
  const { data, error } = await supabase
    .from('route_checkpoints')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching route_checkpoints:', error);
    return;
  }

  console.log('Columns in route_checkpoints:', Object.keys(data[0] || {}));
}

checkRouteCheckpointsSchema();
