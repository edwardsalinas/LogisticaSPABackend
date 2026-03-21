import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('Error fetching users:', error);
    return;
  }
  const clientUser = users.users.find(u => u.email === 'cliente@logistica.bo');
  if (clientUser) {
    console.log('=============================');
    console.log('Usuario:', clientUser.email);
    console.log('ID:', clientUser.id);
    console.log('Rol asignado:', clientUser.user_metadata?.role || '(ninguno)');
    console.log('=============================');
  } else {
    console.log('cliente@logistica.bo no encontrado en auth.users');
  }
}

checkUser();
