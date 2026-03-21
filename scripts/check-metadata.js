import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMetadata() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) return console.error(error);
  
  const clientUser = users.users.find(u => u.email === 'cliente@logistica.bo');
  if (clientUser) {
    console.log('Metadatos completos:', JSON.stringify(clientUser.user_metadata, null, 2));
  }
}
checkMetadata();
