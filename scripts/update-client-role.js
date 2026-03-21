import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateUser() {
  const email = 'cliente@logistica.bo';
  
  // Find user ID
  const { data: users, error: fetchError } = await supabase.auth.admin.listUsers();
  if (fetchError) return console.error(fetchError);
  
  const clientUser = users.users.find(u => u.email === email);
  if (!clientUser) return console.log('Usuario no encontrado');

  // Update their metadata
  const { data, error } = await supabase.auth.admin.updateUserById(clientUser.id, {
    user_metadata: { ...clientUser.user_metadata, role: 'client' }
  });

  if (error) {
    console.error('Error al actualizar el usuario:', error);
  } else {
    console.log(`Rol de ${email} actualizado exitosamente a: client`);
  }
}

updateUser();
