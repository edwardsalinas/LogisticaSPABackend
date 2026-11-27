/**
 * Mide con el sistema REAL tres requerimientos de la tesis y deja el resultado en pantalla:
 *   META SMART  : el agente responde consultas logísticas en menos de 2 segundos (con el modelo real, no con simulaciones).
 *   RNF03       : el sistema soporta al menos 100 lecturas concurrentes de clientes rastreando paquetes.
 *   RNF01       : las consultas del chat de IA no afectan la velocidad de inserción de nuevas guías.
 *
 *   node --env-file=.env scripts/medir-requerimientos.mjs            (usa http://localhost:18080, la app en Docker)
 *   BASE_URL=http://localhost:3000 node --env-file=.env scripts/medir-requerimientos.mjs
 *
 * Qué toca: lee paquetes del cliente de prueba, hace consultas al asistente y CREA unos pocos paquetes de medición (etiqueta MEDIR-<sello>) que
 * borra al terminar (solo los que creó, por su id y su etiqueta). Las cuentas de prueba salen de ../LogisticaSPAFrontend/.env.e2e.local.
 * Limitación honesta: los 100 lectores comparten UNA cuenta de cliente (solo hay una), no son 100 personas distintas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serviceSupabase as db } from '../src/shared/config/supabase.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:18080';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
const envFile = resolve(process.cwd(), '..', 'LogisticaSPAFrontend', '.env.e2e.local');
const fileEnv = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const cred = (r) => ({ email: process.env[`E2E_${r}_EMAIL`] ?? fileEnv[`E2E_${r}_EMAIL`], password: process.env[`E2E_${r}_PASSWORD`] ?? fileEnv[`E2E_${r}_PASSWORD`] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (t0) => Math.round(performance.now() - t0);
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), p50: pct(arr, 50), p95: pct(arr, 95), max: Math.max(...arr) });

const login = async (role) => {
  const { email, password } = cred(role);
  const r = await fetch(`${BASE}/api/iam/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${role}: ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};
const api = (cookie, path, opts = {}) => fetch(`${BASE}/api${path}`, { ...opts, headers: { ...H, cookie, ...(opts.headers ?? {}) } });
const list = async (cookie, path) => { const r = await api(cookie, path); const j = await r.json().catch(() => ({})); return Array.isArray(j) ? j : j.data ?? []; };

const tag = `MEDIR-${Date.now()}`;
const created = [];
const report = { base: BASE, fecha: new Date().toISOString() };

try {
  const admin = await login('ADMIN');
  const operator = await login('OPERATOR');
  const client = await login('CLIENT');

  // ======================================================= META SMART: tiempo de respuesta del agente (modelo real)
  console.log('\n== Tiempo de respuesta del agente (modelo real, sin simulaciones)');
  const mine = await list(client, '/logistics/packages');
  const code = mine.find((p) => p.tracking_code)?.tracking_code;
  const casos = [
    ['cliente: estado de su paquete por código', client, code ? `¿Dónde está mi paquete ${code}?` : '¿Dónde están mis paquetes?'],
    ['cliente: sus paquetes', client, '¿Qué paquetes tengo?'],
    ['admin: cómo va la operación', admin, '¿Cómo va la operación hoy?'],
    ['admin: resumen del día', admin, 'Dame el resumen del día'],
    ['admin: estado de un paquete', admin, code ? `Estado del paquete ${code}` : 'Estado de la flota'],
    ['operador: qué atender', operator, '¿Qué debo atender primero?'],
  ];
  const totales = [];
  const primeros = [];
  for (const [nombre, cookie, message] of casos) {
    // respuesta completa (como la pide un cliente sin streaming)
    let t0 = performance.now();
    const r = await api(cookie, '/ai-agent/chat', { method: 'POST', body: JSON.stringify({ message }) });
    await r.json().catch(() => ({}));
    const total = ms(t0);
    // la misma pregunta con respuesta en vivo: cuándo llega lo primero que ve la persona
    await sleep(5000);
    t0 = performance.now();
    const s = await api(cookie, '/ai-agent/chat/stream', { method: 'POST', body: JSON.stringify({ message }) });
    let first = null; let fin = null;
    if (s.ok && s.body) {
      const reader = s.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const line of buf.split(/\r?\n/)) {
          if (!line.startsWith('data: ')) continue;
          try { const ev = JSON.parse(line.slice(6)); if (first === null && (ev.type === 'token' || ev.type === 'delta' || ev.type === 'text')) first = ms(t0); if (ev.type === 'final') fin = ms(t0); } catch { /* línea parcial */ }
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
      }
    }
    const status = r.status;
    console.log(`  ${status === 200 ? '✔' : '✖ HTTP ' + status}  ${nombre.padEnd(42)} total ${String(total).padStart(5)} ms | primer texto en vivo ${first === null ? '  —  ' : String(first).padStart(5)} ms | final en vivo ${fin === null ? ' — ' : String(fin).padStart(5)} ms`);
    if (status === 200) { totales.push(total); if (first !== null) primeros.push(first); }
    await sleep(6000);
  }
  if (totales.length) {
    const bajo2 = totales.filter((t) => t < 2000).length;
    report.agente = { respuestaCompleta: stats(totales), primerTextoEnVivo: primeros.length ? stats(primeros) : null, menosDe2s: `${bajo2} de ${totales.length}` };
    console.log(`  → respuesta completa: p50 ${report.agente.respuestaCompleta.p50} ms, máx ${report.agente.respuestaCompleta.max} ms; menos de 2 s: ${report.agente.menosDe2s}`);
    if (primeros.length) console.log(`  → primer texto en vivo: p50 ${report.agente.primerTextoEnVivo.p50} ms, máx ${report.agente.primerTextoEnVivo.max} ms`);
  }

  // ======================================================= RNF03: 100 lecturas concurrentes de rastreo
  console.log('\n== 100 lecturas concurrentes de clientes rastreando paquetes');
  const pkg = mine.find((p) => p.id);
  if (!pkg) console.log('  (el cliente de prueba no tiene paquetes: no se puede medir)');
  else {
    const una = async (path) => { const t0 = performance.now(); try { const r = await api(client, path); await r.arrayBuffer(); return { ok: r.status === 200, status: r.status, t: ms(t0) }; } catch { return { ok: false, status: 0, t: ms(t0) }; } };
    for (const [nombre, path] of [['historial de rastreo del paquete', `/tracking/logs/${pkg.id}`], ['lista de sus paquetes', '/logistics/packages']]) {
      const t0 = performance.now();
      const rs = await Promise.all(Array.from({ length: 100 }, () => una(path)));
      const total = ms(t0);
      const oks = rs.filter((x) => x.ok).length;
      const st = stats(rs.map((x) => x.t));
      const codigos = [...new Set(rs.filter((x) => !x.ok).map((x) => x.status))];
      console.log(`  ${oks === 100 ? '✔' : '✖'} ${nombre.padEnd(34)} ${oks}/100 correctas${codigos.length ? ` (fallos: ${codigos.join(',')})` : ''} | p50 ${st.p50} ms, p95 ${st.p95} ms, máx ${st.max} ms | las 100 en ${total} ms`);
      (report.concurrencia ??= []).push({ prueba: nombre, correctas: oks, p50: st.p50, p95: st.p95, max: st.max, totalMs: total });
      await sleep(1500);
    }
  }

  // ======================================================= RNF01: el chat no frena la inserción de guías
  console.log('\n== ¿Las consultas del chat afectan la inserción de nuevas guías?');
  const crear = async (i) => {
    const t0 = performance.now();
    const r = await api(operator, '/logistics/packages', { method: 'POST', body: JSON.stringify({ origen: 'La Paz', destino: 'Oruro', peso: 1, recipient_name: `${tag} ${i}`, description: tag, sender_name: 'Medición', is_guest: true }) });
    const j = await r.json().catch(() => ({}));
    const id = j?.data?.id ?? j?.id ?? j?.data?.package?.id;
    if (id) created.push(id);
    return { ok: r.status === 201 || r.status === 200, t: ms(t0) };
  };
  const N = 8;
  const base = [];
  for (let i = 0; i < N; i += 1) { base.push(await crear(i)); }
  // mientras tanto, 4 consultas al chat al mismo tiempo (dentro del límite de 15 por minuto)
  const carga = ['¿Cómo va la operación hoy?', 'Dame el resumen del día', '¿Qué debo atender primero?', '¿Qué viajes hay mañana?'].map((m) => api(admin, '/ai-agent/chat', { method: 'POST', body: JSON.stringify({ message: m }) }).then((r) => r.arrayBuffer()).catch(() => null));
  await sleep(300); // que las consultas estén en vuelo
  const bajoCarga = [];
  for (let i = 0; i < N; i += 1) { bajoCarga.push(await crear(100 + i)); }
  await Promise.all(carga);
  const a = base.filter((x) => x.ok).map((x) => x.t);
  const b = bajoCarga.filter((x) => x.ok).map((x) => x.t);
  if (a.length && b.length) {
    const sa = stats(a); const sb = stats(b);
    const ratio = Math.round((sb.p50 / sa.p50) * 100) / 100;
    console.log(`  inserciones sin chat:   ${a.length}/${N} correctas | p50 ${sa.p50} ms, p95 ${sa.p95} ms`);
    console.log(`  inserciones con chat:   ${b.length}/${N} correctas | p50 ${sb.p50} ms, p95 ${sb.p95} ms  (mediana ${ratio}× la de referencia)`);
    report.insercion = { sinChat: sa, conChat: sb, razonMediana: ratio };
  } else console.log('  no se pudieron crear paquetes de medición (revisar cuentas/permisos)');
} finally {
  // ======================================================= limpieza: solo lo que esta medición creó
  if (created.length) {
    const { data: logs } = await db.from('tracking_logs').select('id').in('package_id', created);
    const logIds = (logs ?? []).map((l) => l.id);
    if (logIds.length) await db.from('checkpoint_visits').delete().in('tracking_log_id', logIds);
    await db.from('tracking_logs').delete().in('package_id', created);
    await db.from('packages').delete().in('id', created).like('description', `${tag}%`);
    const { count } = await db.from('packages').select('id', { count: 'exact', head: true }).in('id', created);
    console.log(`\nLimpieza: ${created.length} paquetes de medición creados, quedan ${count ?? 0}.`);
  }
  console.log('\nResumen JSON:', JSON.stringify(report));
}
