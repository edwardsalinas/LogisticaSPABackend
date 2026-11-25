/**
 * Datos de demostración para mostrar a Logi (avisos de excepciones) y el resto del sistema sin esperar a que haya operación real.
 *
 *   node --env-file=.env scripts/seed-demo.mjs            # crea los datos
 *   node --env-file=.env scripts/seed-demo.mjs --remove   # los borra (solo los marcados DEMO-LOGI)
 *
 * Crea: un viaje La Paz → Oruro que sale en ~10 h con conductor y 3 paquetes sueltos del mismo trayecto (aviso «Paquetes sueltos»),
 * un viaje Cochabamba → Santa Cruz que sale en ~20 h SIN conductor (aviso «Viaje sin conductor»), y un viaje Oruro → Potosí que debió
 * salir hace 2 horas con 2 paquetes asignados (aviso «Un viaje no ha salido»). Todo lleva la marca DEMO-LOGI en la descripción
 * de los paquetes y en el código del viaje: el borrado solo toca lo marcado y nunca por patrón amplio.
 * Las salidas son relativas a «ahora»: conviene sembrar poco antes de la demostración.
 */
import { randomBytes } from 'node:crypto';
import { serviceSupabase as db } from '../src/shared/config/supabase.js';

const MARK = 'DEMO-LOGI';
const HOUR = 3600 * 1000;
const remove = process.argv.includes('--remove');

const must = (label, { data, error }) => {
  if (error) { console.error(`FALLA ${label}: ${error.message}`); process.exit(1); }
  console.log(`ok    ${label}`);
  return data;
};

const existingRoutes = must('buscar viajes de demo', await db.from('transport_routes').select('id').like('route_code', `${MARK}%`)) ?? [];
const existingPkgs = must('buscar paquetes de demo', await db.from('packages').select('id').like('description', `${MARK}%`)) ?? [];

// ---- borrado: solo lo marcado
if (remove) {
  const pkgIds = existingPkgs.map((p) => p.id);
  if (pkgIds.length) {
    const logs = (await db.from('tracking_logs').select('id').in('package_id', pkgIds)).data ?? [];
    if (logs.length) await db.from('checkpoint_visits').delete().in('tracking_log_id', logs.map((l) => l.id));
    must('historial', await db.from('tracking_logs').delete().in('package_id', pkgIds));
    must('paquetes', await db.from('packages').delete().in('id', pkgIds).like('description', `${MARK}%`));
  }
  for (const r of existingRoutes) {
    const { error } = await db.rpc('delete_route_cascade', { p_id: r.id });
    console.log(error ? `FALLA ruta ${r.id.slice(0, 8)}: ${error.message}` : `ok    ruta ${r.id.slice(0, 8)} borrada`);
  }
  console.log(`listo: ${pkgIds.length} paquetes y ${existingRoutes.length} viajes de demo borrados`);
  process.exit(0);
}

if (existingRoutes.length || existingPkgs.length) {
  console.error('Ya hay datos de demo. Bórralos primero con --remove.');
  process.exit(1);
}

// ---- personas y vehículos reales ya existentes (no se crea ninguno)
const pick = async (table, filter) => (await filter(db.from(table).select('id'))).data?.[0]?.id ?? null;
const driverId = await pick('profiles', (q) => q.eq('role', 'driver'));
const clientId = await pick('profiles', (q) => q.eq('role', 'client'));
const vehicles = must('vehículos', await db.from('vehicles').select('id, plate, capacity_kg').order('capacity_kg', { ascending: false }));
const big = vehicles.find((v) => v.capacity_kg >= 5000) ?? vehicles[0];
const small = vehicles.find((v) => v.id !== big.id) ?? big;

// Salidas relativas a AHORA (siempre dentro de la ventana de los avisos): el viaje con conductor sale en ~10 h y el que no tiene
// conductor en ~20 h (los avisos de «sin conductor» miran las próximas 24 h), redondeados a la media hora
const HALF = 30 * 60 * 1000;
const inHours = (h) => new Date(Math.round((Date.now() + h * HOUR) / HALF) * HALF).toISOString();

const CITY = {
  'La Paz': [-16.5, -68.1193], Oruro: [-17.9833, -67.15], Cochabamba: [-17.3895, -66.1568],
  'Santa Cruz': [-17.7833, -63.1821], 'Potosí': [-19.5836, -65.7531],
};
const routeRow = (code, origin, destination, departure, driver, vehicle) => ({
  route_code: code, origin, destination, departure_time: departure, status: 'planeada', driver_id: driver, vehicle_id: vehicle,
  origin_lat: CITY[origin][0], origin_lng: CITY[origin][1], dest_lat: CITY[destination][0], dest_lng: CITY[destination][1],
});

const [rOk, rNoDriver, rLate] = must('viajes', await db.from('transport_routes').insert([
  routeRow(`${MARK}-1`, 'La Paz', 'Oruro', inHours(10), driverId, big.id),
  routeRow(`${MARK}-2`, 'Cochabamba', 'Santa Cruz', inHours(20), null, small.id),
  routeRow(`${MARK}-3`, 'Oruro', 'Potosí', new Date(Date.now() - 2 * HOUR).toISOString(), driverId, big.id),
]).select('id'));

const code = () => `TRK-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
const pkg = (origen, destino, peso, who, phone, what, route = null) => ({
  tracking_code: code(), origen, destino, peso, description: `${MARK} ${what}`, status: route ? 'asignado' : 'pendiente', route_id: route,
  sender_id: clientId, sender_name: 'María López', sender_phone: '70123456', recipient_name: who, recipient_phone: phone,
});
const rows = [
  pkg('La Paz', 'Oruro', 4, 'Rosa Quispe', '71234501', 'Documentos de oficina'),
  pkg('La Paz', 'Oruro', 12, 'Carlos Mamani', '71234502', 'Repuestos de bicicleta'),
  pkg('La Paz', 'Oruro', 7.5, 'Lucía Flores', '71234503', 'Ropa y calzado'),
  pkg('Cochabamba', 'Santa Cruz', 9, 'Marco Rojas', '71234504', 'Medicamentos'),
  pkg('Oruro', 'Potosí', 15, 'Elena Choque', '71234505', 'Alimentos no perecederos', rLate.id),
  pkg('Oruro', 'Potosí', 6, 'Jorge Vargas', '71234506', 'Material escolar', rLate.id),
];
const created = must('paquetes', await db.from('packages').insert(rows).select('id, origen, status'));

const logs = created.map((p) => ({
  package_id: p.id, lat: CITY[p.origen][0], lng: CITY[p.origen][1], status: p.status === 'asignado' ? 'Asignado' : 'Pendiente',
  observations: 'Datos de demostración', timestamp: new Date().toISOString(),
}));
must('historial', await db.from('tracking_logs').insert(logs));

console.log(`\nlisto: 3 viajes (${rOk.id.slice(0, 8)}…, ${rNoDriver.id.slice(0, 8)}…, ${rLate.id.slice(0, 8)}…) y ${created.length} paquetes de demo.`);
console.log('Para borrarlos: node --env-file=.env scripts/seed-demo.mjs --remove');
