/**
 * Rellena el primer eslabón de la cadena de custodia (RF03) de los paquetes anteriores a que se registrara quién
 * crea un paquete: añade el evento «Pendiente» con la fecha REAL de creación (created_at) y SIN responsable
 * (recorded_by vacío), con una observación que lo dice. No se inventa un responsable ni la fecha de la asignación.
 *
 *   node --env-file=.env scripts/backfill-custody.mjs            # solo muestra qué haría
 *   node --env-file=.env scripts/backfill-custody.mjs --apply    # lo escribe
 *
 * Es seguro repetirlo: solo toca paquetes que no tienen ningún evento «Pendiente».
 */
import { serviceSupabase as db } from '../src/shared/config/supabase.js';
import { custodyLocation } from '../src/modules/logistics/logistics.service.js';

export const BACKFILL_NOTE = 'Registro anterior a la cadena de custodia: responsable no registrado';
const apply = process.argv.includes('--apply');

const { data: packages, error } = await db.from('packages').select('id, tracking_code, origen, route_id, created_at, status');
if (error) { console.error(error.message); process.exit(1); }

let todo = 0;
for (const pkg of packages) {
  const { data: pend } = await db.from('tracking_logs').select('id').eq('package_id', pkg.id).ilike('status', 'pendiente').limit(1);
  if (pend?.length) continue;
  todo += 1;
  const position = await custodyLocation(pkg, db);
  console.log(`${apply ? 'agrega ' : 'agregaría'} «Pendiente» a ${pkg.tracking_code} (creado ${pkg.created_at}, sin responsable)`);
  if (apply) {
    const { error: e } = await db.from('tracking_logs').insert({
      package_id: pkg.id, lat: position.lat, lng: position.lng, status: 'Pendiente',
      observations: BACKFILL_NOTE, recorded_by: null, timestamp: pkg.created_at,
    });
    if (e) console.error('  FALLA:', e.message);
  }
}
console.log(`${todo} paquete(s) sin evento «Pendiente»${apply ? ' (rellenados)' : ' (use --apply para rellenar)'}`);
process.exit(0);
