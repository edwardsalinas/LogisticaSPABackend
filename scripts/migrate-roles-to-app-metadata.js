/**
 * Migra el rol de cada usuario de `user_metadata` (editable por el propio usuario) a `app_metadata`
 * (solo escribible por el servidor). Es el paso previo para cerrar la brecha de escalada de privilegios.
 *
 * Uso:
 *   node --env-file=.env scripts/migrate-roles-to-app-metadata.js --dry-run   (solo muestra los cambios)
 *   node --env-file=.env scripts/migrate-roles-to-app-metadata.js             (aplica los cambios)
 *
 * Después de ejecutarlo, define AUTH_ALLOW_USER_METADATA_ROLE=false en el backend.
 */
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const VALID_ROLES = ['admin', 'logistics_operator', 'driver', 'client'];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAllUsers() {
  const users = [];
  const PER_PAGE = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }
  return users;
}

async function main() {
  const users = await listAllUsers();
  let migrated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const user of users) {
    const legacyRole = user.user_metadata?.role;
    if (user.app_metadata?.role) {
      skipped += 1; // ya migrado
      continue;
    }
    if (!legacyRole) {
      skipped += 1; // sin rol: se tratará como "client"
      continue;
    }
    if (!VALID_ROLES.includes(legacyRole)) {
      console.warn(`⚠️  ${user.email}: rol desconocido "${legacyRole}" (se omite)`);
      invalid += 1;
      continue;
    }

    console.log(`${DRY_RUN ? '(simulación) ' : ''}${user.email}: ${legacyRole} → app_metadata.role`);
    if (!DRY_RUN) {
      const { error } = await supabase.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, role: legacyRole },
      });
      if (error) {
        console.error(`❌ ${user.email}: ${error.message}`);
        continue;
      }
    }
    migrated += 1;
  }

  console.log(`\nUsuarios: ${users.length} | migrados: ${migrated} | sin cambios: ${skipped} | roles inválidos: ${invalid}`);
  if (!DRY_RUN && migrated + skipped === users.length - invalid) {
    console.log('Listo. Ahora puedes definir AUTH_ALLOW_USER_METADATA_ROLE=false en el backend.');
  }
}

main().catch((err) => {
  console.error('Error en la migración de roles:', err.message);
  process.exit(1);
});
