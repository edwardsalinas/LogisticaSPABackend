/**
 * Rota las contraseñas de los cuatro usuarios de prueba (administrador, operador, conductor y cliente) por contraseñas aleatorias nuevas.
 *
 *   node --env-file=.env scripts/rotar-claves-prueba.mjs            # solo muestra qué haría (no cambia nada)
 *   node --env-file=.env scripts/rotar-claves-prueba.mjs --aplicar  # las cambia de verdad
 *
 * Por qué existe: las contraseñas de estas cuentas estuvieron escritas en el código del repositorio (que es público) y siguen en su historial
 * de git, que no se puede reescribir de forma segura. La única solución real es cambiarlas.
 *
 * Qué hace con --aplicar:
 *  - cambia la contraseña de cada cuenta en Supabase Auth (con la clave de servicio);
 *  - las guarda SOLO en dos archivos que git ignora: LogisticaSPAFrontend/.env.e2e.local (las leen las pruebas de extremo a extremo) y
 *    credenciales.local.txt (para que las veas tú);
 *  - NO las muestra en pantalla ni en ningún registro.
 * Después: las sesiones abiertas siguen valiendo hasta que venzan; las pruebas renuevan sus sesiones solas.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serviceSupabase as db } from '../src/shared/config/supabase.js';

const APPLY = process.argv.includes('--aplicar');
const ACCOUNTS = [
  { key: 'ADMIN', label: 'administrador', email: process.env.E2E_ADMIN_EMAIL || 'admin@logistica.bo' },
  { key: 'OPERATOR', label: 'operador', email: process.env.E2E_OPERATOR_EMAIL || 'operador@logistica.bo' },
  { key: 'DRIVER', label: 'conductor', email: process.env.E2E_DRIVER_EMAIL || 'driver@logistica.bo' },
  { key: 'CLIENT', label: 'cliente', email: process.env.E2E_CLIENT_EMAIL || 'cliente@logistica.bo' },
];
const FRONT = resolve(process.cwd(), '..', 'LogisticaSPAFrontend');

// 20 caracteres: letras, números y símbolos que no rompen un archivo .env ni la línea de comandos
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.+';
const newPassword = () => {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${out}9a`; // garantiza al menos un número y una minúscula
};

const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
if (error) { console.error('No se pudo leer la lista de usuarios:', error.message); process.exit(1); }

const plan = ACCOUNTS.map((a) => ({ ...a, user: list.users.find((u) => u.email === a.email) }));
for (const a of plan) console.log(`${a.user ? 'encontrada' : 'NO EXISTE  '}  ${a.label.padEnd(13)} ${a.email}`);
const missing = plan.filter((a) => !a.user);
if (missing.length) console.log(`\nSe omiten ${missing.length} cuenta(s) que no existen.`);

if (!APPLY) {
  console.log('\nSimulación: no se cambió nada. Para aplicarlo:  node --env-file=.env scripts/rotar-claves-prueba.mjs --aplicar');
  process.exit(0);
}

const done = [];
for (const a of plan.filter((x) => x.user)) {
  const password = newPassword();
  const { error: e } = await db.auth.admin.updateUserById(a.user.id, { password });
  if (e) { console.error(`FALLA ${a.email}: ${e.message}`); continue; }
  done.push({ ...a, password });
  console.log(`contraseña cambiada: ${a.email}`);
}
if (!done.length) process.exit(1);

// archivo que leen las pruebas de extremo a extremo (git lo ignora)
if (existsSync(FRONT)) {
  const lines = ['# Usuarios de prueba de las pruebas e2e. NO se versiona (está en .gitignore). Creado por scripts/rotar-claves-prueba.mjs.'];
  for (const a of ACCOUNTS) {
    const d = done.find((x) => x.key === a.key);
    lines.push(`E2E_${a.key}_EMAIL=${a.email}`);
    if (d) lines.push(`E2E_${a.key}_PASSWORD=${d.password}`);
  }
  writeFileSync(resolve(FRONT, '.env.e2e.local'), `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`guardado: ${resolve(FRONT, '.env.e2e.local')}`);
}
// para que la persona las lea
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
appendFileSync('credenciales.local.txt', `\n== Usuarios de prueba (rotadas ${stamp}) ==\n${done.map((d) => `${d.label.padEnd(13)}: ${d.email} / ${d.password}`).join('\n')}\n`);
console.log('guardado: credenciales.local.txt (ignorado por git)');
console.log(`\nListo: ${done.length} contraseña(s) nueva(s). No se mostraron en pantalla.`);
