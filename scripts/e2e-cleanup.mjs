/**
 * Limpia los datos que crean las pruebas end-to-end del frontend (LogisticaSPAFrontend/e2e).
 * Lee el archivo e2e-results/created.json (rutas y paquetes creados) y los borra, con su historial.
 *
 *   node --env-file=.env scripts/e2e-cleanup.mjs ../LogisticaSPAFrontend/e2e-results/created.json
 *
 * Solo borra lo que figura en ese archivo y lo marcado con la etiqueta E2E-<sello>; nunca borra por patrón amplio.
 */
import { readFileSync } from 'node:fs';
import { serviceSupabase as db } from '../src/shared/config/supabase.js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node --env-file=.env scripts/e2e-cleanup.mjs <created.json>');
  process.exit(1);
}

const { tag, routeIds = [], packageIds = [] } = JSON.parse(readFileSync(file, 'utf8'));
if (!/^E2E-\d+$/.test(tag || '')) {
  console.error('created.json no tiene una etiqueta E2E-<sello> válida; no se borra nada.');
  process.exit(1);
}

const step = async (label, promise) => {
  const { error, count } = await promise;
  console.log(`${error ? 'FALLA' : 'ok   '} ${label}${error ? ': ' + error.message : count != null ? ` (${count})` : ''}`);
  return !error;
};

// 1) historial de los paquetes (y visitas a checkpoints que cuelgan de ese historial)
if (packageIds.length) {
  const { data: logs } = await db.from('tracking_logs').select('id').in('package_id', packageIds);
  const logIds = (logs || []).map((l) => l.id);
  if (logIds.length) await step('visitas a checkpoints', db.from('checkpoint_visits').delete({ count: 'exact' }).in('tracking_log_id', logIds));
  await step('historial de seguimiento', db.from('tracking_logs').delete({ count: 'exact' }).in('package_id', packageIds));
}

// 2) paquetes de prueba (solo los listados y con la etiqueta)
if (packageIds.length) {
  await step('paquetes', db.from('packages').delete({ count: 'exact' }).in('id', packageIds).eq('description', tag));
}

// 3) rutas de prueba con la función atómica de la migración 019 (borra también sus viajes y checkpoints)
for (const id of routeIds) {
  const { error } = await db.rpc('delete_route_cascade', { p_id: id });
  console.log(`${error ? 'FALLA' : 'ok   '} ruta ${id.slice(0, 8)}…${error ? ': ' + error.message : ''}`);
}

// 4) comprobación
const left = { paquetes: 0, rutas: 0 };
if (packageIds.length) left.paquetes = (await db.from('packages').select('id', { count: 'exact', head: true }).in('id', packageIds)).count ?? 0;
if (routeIds.length) left.rutas = (await db.from('transport_routes').select('id', { count: 'exact', head: true }).in('id', routeIds)).count ?? 0;
console.log(`quedan: ${left.paquetes} paquetes y ${left.rutas} rutas de prueba`);
process.exit(left.paquetes || left.rutas ? 1 : 0);
