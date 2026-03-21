import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPackages() {
  const { data: packages, error } = await supabase
    .from('packages')
    .select('id, tracking_code, sender_id, status')
    .limit(20);

  if (error) return console.error(error);
  
  console.log('--- Listado de Paquetes ---');
  packages.forEach(p => {
    console.log(`ID: ${p.id} | Code: ${p.tracking_code} | Sender: ${p.sender_id} | Status: ${p.status}`);
  });
  
  const { data: users } = await supabase.auth.admin.listUsers();
  const cliente = users.users.find(u => u.email === 'cliente@logistica.bo');
  console.log(`\nID de cliente@logistica.bo: ${cliente?.id}`);
}

checkPackages();
