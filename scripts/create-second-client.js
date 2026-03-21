import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createNewClient() {
  const email = 'nuevo.cliente@logistica.bo';
  const password = 'Password123!';
  
  console.log(`Intentando crear cliente: ${email}...`);
  
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'client',
      full_name: 'Pedro Picapiedra (Nuevo Cliente)'
    }
  });

  if (error) {
    console.error('Error creando usuario:', error.message);
  } else {
    console.log('Usuario creado con éxito:', data.user.id);
  }
}

createNewClient();
