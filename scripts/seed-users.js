import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USERS = [
  { email: 'admin@logistica.bo',    password: 'Admin123!',    role: 'admin',              name: 'Carlos Mendoza (Admin)' },
  { email: 'operador@logistica.bo', password: 'Operador123!', role: 'logistics_operator', name: 'Ana García (Operadora)' },
  { email: 'driver@logistica.bo',   password: 'Driver123!',   role: 'driver',             name: 'Juan Pérez (Conductor)' },
  { email: 'cliente@logistica.bo',  password: 'Cliente123!',  role: 'client',             name: 'María López (Cliente)' },
];

async function seedUsers() {
  console.log('🌱 Creando usuarios de prueba...\n');

  for (const user of USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true, // Auto-confirmar email
      user_metadata: {
        role: user.role,
        full_name: user.name,
      },
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        // Si ya existe, actualizar el rol
        const { data: users } = await supabase.auth.admin.listUsers();
        const existing = users.users.find(u => u.email === user.email);
        if (existing) {
          await supabase.auth.admin.updateUserById(existing.id, {
            user_metadata: { role: user.role, full_name: user.name },
          });
          console.log(`🔄 ${user.email} — rol actualizado a "${user.role}"`);
        }
      } else {
        console.error(`❌ ${user.email}: ${error.message}`);
      }
    } else {
      console.log(`✅ ${user.email} — creado con rol "${user.role}"`);
    }
  }

  console.log('\n📋 Credenciales para login:');
  console.log('─'.repeat(60));
  USERS.forEach(u => {
    console.log(`  ${u.role.padEnd(20)} → ${u.email} / ${u.password}`);
  });
  console.log('─'.repeat(60));
}

seedUsers().catch(console.error);
