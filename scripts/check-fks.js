import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFKs() {
  const sql = `
    SELECT
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='transport_routes';
  `;

  const { data, error } = await supabase.rpc('execute_sql_query', { sql_query: sql });
  if (error) {
    if (error.message.includes('function execute_sql_query() does not exist')) {
        console.log('RPC execute_sql_query not available. Trying to find FKs by table select error...');
        // If we can't run raw SQL, we can try to join and see the error (already did).
        console.log('Assuming FK is missing based on PostgREST error.');
    } else {
        console.error('Error checking FKs:', error.message);
    }
  } else {
    console.log('FKs:', data);
  }
}

checkFKs();
