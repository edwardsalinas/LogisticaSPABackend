import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Las contraseñas NO están escritas en el código (este repositorio es público): salen de SEED_<ROL>_PASSWORD o se generan al azar en cada ejecución
// y se muestran una sola vez al final. Si la cuenta ya existe, su contraseña NO se cambia (para eso: scripts/rotar-claves-prueba.mjs).
const pw = (role) => process.env[`SEED_${role}_PASSWORD`] || `${randomBytes(14).toString('base64url')}9a`;

const USERS = [
  { email: 'admin@logistica.bo',    password: pw('ADMIN'),    role: 'admin',              name: 'Carlos Mendoza (Admin)' },
  { email: 'operador@logistica.bo', password: pw('OPERATOR'), role: 'logistics_operator', name: 'Ana García (Operadora)' },
  { email: 'driver@logistica.bo',   password: pw('DRIVER'),   role: 'driver',             name: 'Juan Pérez (Conductor)' },
  { email: 'cliente@logistica.bo',  password: pw('CLIENT'),  role: 'client',             name: 'María López (Cliente)' },
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
      // El rol confiable vive en app_metadata (solo escribible por el servidor)
      app_metadata: { role: user.role },
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        // Si ya existe, actualizar el rol
        const { data: users } = await supabase.auth.admin.listUsers();
        const existing = users.users.find(u => u.email === user.email);
        if (existing) {
          await supabase.auth.admin.updateUserById(existing.id, {
            user_metadata: { role: user.role, full_name: user.name },
            app_metadata: { role: user.role },
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
