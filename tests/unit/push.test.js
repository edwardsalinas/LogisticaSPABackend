import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  HOUR_MS, URGENT_GAP_MS, MAX_SUBSCRIPTIONS_PER_USER, isPushEndpoint, isMissingTable, pushStatus, saveSubscription,
  removeSubscription, buildPayload, runPushRound, subscriptionSchema, vapidConfigured,
} from '../../src/modules/notifications/push.service.js';
import * as controller from '../../src/modules/notifications/notifications.controller.js';
import { pushLimiter } from '../../src/shared/middlewares/rateLimit.js';

const NOW = Date.parse('2026-11-26T16:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const GOOD = 'https://fcm.googleapis.com/fcm/send/abc123';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const ENV = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' };

/** Base simulada de push_subscriptions: select/eq/in/order/limit/upsert/update/delete. */
const fakeDb = (rows = [], { missing = false } = {}) => {
  const state = { rows: rows.map((r) => ({ ...r })), calls: [] };
  const from = (table) => {
    assert.equal(table, 'push_subscriptions');
    const q = { f: [], op: 'select', payload: null, limit: null, head: false, order: null };
    const matching = () => {
      let r = state.rows.filter((row) => q.f.every((fn) => fn(row)));
      if (q.order) r = [...r].sort((a, b) => (a[q.order.col] < b[q.order.col] ? 1 : -1) * (q.order.asc ? -1 : 1));
      return q.limit != null ? r.slice(0, q.limit) : r;
    };
    const run = () => {
      // Como PostgREST de verdad: una consulta HEAD no tiene cuerpo, así que sobre una tabla inexistente responde 204 SIN error
      if (missing && q.head) return { data: null, error: null };
      if (missing) return { data: null, error: { code: '42P01', message: 'relation "public.push_subscriptions" does not exist' } };
      if (q.op === 'upsert') {
        const i = state.rows.findIndex((r) => r.endpoint === q.payload.endpoint);
        if (i >= 0) Object.assign(state.rows[i], q.payload); else { state.seq = (state.seq ?? 0) + 1; state.rows.push({ id: `id${state.seq}`, created_at: new Date(NOW + state.seq * 1000).toISOString(), sent_alert_ids: {}, ...q.payload }); }
        return { data: null, error: null };
      }
      if (q.op === 'update') { for (const r of matching()) Object.assign(r, q.payload); state.calls.push(['update', q.payload]); return { data: null, error: null }; }
      if (q.op === 'delete') { const hit = matching(); state.rows = state.rows.filter((r) => !hit.includes(r)); state.calls.push(['delete', hit.length]); return { data: null, error: null }; }
      return { data: q.head ? null : matching(), error: null };
    };
    const b = {
      select: (_c, opts) => { q.head = Boolean(opts?.head); return b; },
      eq: (c, v) => { q.f.push((r) => r[c] === v); return b; },
      in: (c, vs) => { q.f.push((r) => vs.includes(r[c])); return b; },
      order: (col, o) => { q.order = { col, asc: o?.ascending !== false }; return b; },
      limit: (n) => { q.limit = n; return b; },
      upsert: (p) => { q.op = 'upsert'; q.payload = p; return b; },
      update: (p) => { q.op = 'update'; q.payload = p; return b; },
      delete: () => { q.op = 'delete'; return b; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, state };
};

const alert = (id, o = {}) => ({ id, severity: 'medium', title: `Aviso ${id}`, text: `Texto con código TRK-${id}`, action: { kind: 'navigate', to: '/tracking' }, ...o });

// ============================================================ la dirección de destino (anti-SSRF)
test('solo se aceptan direcciones https de los servicios de notificaciones de los navegadores', () => {
  for (const ok of [GOOD, 'https://updates.push.services.mozilla.com/wpush/v2/xyz', 'https://wns2-par02p.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/QL3abc', 'https://eu.push.apple.com/abc']) {
    assert.equal(isPushEndpoint(ok), true, ok);
  }
});

test('una dirección interna o ajena NUNCA se acepta (el servidor no puede usarse para llamarla)', () => {
  const bad = [
    'http://fcm.googleapis.com/fcm/send/abc', 'http://localhost:3000/api/iam/login', 'https://localhost/x', 'http://127.0.0.1/x', 'https://127.0.0.1/x',
    'http://169.254.169.254/latest/meta-data/', 'https://metadata.google.internal/x', 'https://10.0.0.5/x', 'https://[::1]/x',
    'https://sitio-ajeno.example/fcm.googleapis.com', 'https://fcm.googleapis.com.sitio-ajeno.example/x', 'https://evilfcm.googleapis.com.evil.io/x',
    'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', '', 'no es una url', null, undefined, 42,
    'https://notify.windows.com.evil.io/x', 'https://evilnotify.windows.com/x'.replace('evilnotify', 'x') + '.evil.io',
  ];
  for (const b of bad) assert.equal(isPushEndpoint(b), false, String(b));
});

test('el cuerpo de la suscripción se valida completo (dirección, claves, tamaños)', () => {
  assert.equal(subscriptionSchema.safeParse({ endpoint: GOOD, keys: KEYS }).success, true);
  for (const bad of [
    {}, { endpoint: GOOD }, { endpoint: GOOD, keys: {} }, { endpoint: GOOD, keys: { p256dh: 'x', auth: 'y' } },
    { endpoint: 'http://localhost/x', keys: KEYS }, { endpoint: GOOD, keys: { ...KEYS, auth: 'a'.repeat(101) } },
    { endpoint: `${GOOD}/${'a'.repeat(1000)}`, keys: KEYS }, { endpoint: ['x'], keys: KEYS }, null,
  ]) assert.equal(subscriptionSchema.safeParse(bad).success, false, JSON.stringify(bad)?.slice(0, 60));
});

// ============================================================ estado y suscripciones
test('vapidConfigured pide las tres variables', () => {
  assert.equal(vapidConfigured(ENV), true);
  for (const k of Object.keys(ENV)) assert.equal(vapidConfigured({ ...ENV, [k]: '' }), false, k);
  assert.equal(vapidConfigured({}), false);
});

test('pushStatus: sin claves o sin tabla la función está apagada; con ambas entrega la clave pública', async () => {
  assert.deepEqual(await pushStatus(fakeDb(), {}), { enabled: false, reason: 'sin_claves' });
  assert.deepEqual(await pushStatus(fakeDb([], { missing: true }), ENV), { enabled: false, reason: 'sin_tabla' });
  assert.deepEqual(await pushStatus(fakeDb(), ENV), { enabled: true, publicKey: 'pub' });
});

test('isMissingTable reconoce los dos errores de «la tabla no existe» y nada más', () => {
  assert.equal(isMissingTable({ code: '42P01', message: 'x' }), true);
  assert.equal(isMissingTable({ code: 'PGRST205', message: 'Could not find the table' }), true);
  assert.equal(isMissingTable({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingTable(null), false);
});

test('suscribirse guarda la fila; volver a activar en el mismo navegador la actualiza y no la duplica', async () => {
  const db = fakeDb();
  await saveSubscription(db, { id: 'u1' }, { endpoint: GOOD, keys: KEYS }, 'Chrome/130');
  await saveSubscription(db, { id: 'u1' }, { endpoint: GOOD, keys: KEYS }, 'Chrome/131');
  assert.equal(db.state.rows.length, 1);
  assert.equal(db.state.rows[0].user_id, 'u1');
  assert.equal(db.state.rows[0].user_agent, 'Chrome/131');
});

test('un navegador que cambia de persona pasa a ser de quien lo activa ahora (no queda con el dueño anterior)', async () => {
  const db = fakeDb();
  await saveSubscription(db, { id: 'u1' }, { endpoint: GOOD, keys: KEYS });
  await saveSubscription(db, { id: 'u2' }, { endpoint: GOOD, keys: KEYS });
  assert.deepEqual(db.state.rows.map((r) => r.user_id), ['u2']);
});

test(`una persona no acumula más de ${MAX_SUBSCRIPTIONS_PER_USER} navegadores: se descartan los más antiguos`, async () => {
  const db = fakeDb();
  for (let i = 0; i < 8; i += 1) {
    await saveSubscription(db, { id: 'u1' }, { endpoint: `https://fcm.googleapis.com/fcm/send/n${i}`, keys: KEYS });
  }
  assert.equal(db.state.rows.filter((r) => r.user_id === 'u1').length, MAX_SUBSCRIPTIONS_PER_USER);
  assert.ok(db.state.rows.some((r) => r.endpoint.endsWith('/n7')), 'se conserva el más reciente');
  assert.equal(db.state.rows.some((r) => r.endpoint.endsWith('/n0')), false, 'se descarta el más antiguo');
});

test('cancelar solo borra la suscripción de QUIEN la pide', async () => {
  const db = fakeDb([{ id: 'a', user_id: 'u1', endpoint: GOOD }, { id: 'b', user_id: 'u2', endpoint: 'https://fcm.googleapis.com/fcm/send/otro' }]);
  await removeSubscription(db, { id: 'u1' }, 'https://fcm.googleapis.com/fcm/send/otro'); // u1 intenta borrar la de u2
  assert.equal(db.state.rows.length, 2);
  await removeSubscription(db, { id: 'u1' }, GOOD);
  assert.deepEqual(db.state.rows.map((r) => r.id), ['b']);
});

test('sin la tabla, suscribirse o cancelar responde «no disponible» (503) y no revela detalles', async () => {
  const db = fakeDb([], { missing: true });
  for (const fn of [() => saveSubscription(db, { id: 'u1' }, { endpoint: GOOD, keys: KEYS }), () => removeSubscription(db, { id: 'u1' }, GOOD)]) {
    await assert.rejects(fn(), (e) => e.status === 503 && !/relation|push_subscriptions/.test(e.message));
  }
});

// ============================================================ qué se envía
test('la notificación dice solo el título del aviso (no códigos ni nombres) y a dónde llevar', () => {
  const p = buildPayload([alert('1', { title: 'Hay paquetes con siniestro', severity: 'high', action: { to: '/tracking' } })]);
  assert.deepEqual(p, { title: 'Logi', body: 'Hay paquetes con siniestro', url: '/tracking', tag: '1', urgent: true });
  assert.doesNotMatch(JSON.stringify(p), /TRK-/);
  assert.equal(buildPayload([alert('1'), alert('2'), alert('3')]).body, 'Aviso 1 (y 2 avisos más)');
  assert.equal(buildPayload([alert('1'), alert('2')]).body, 'Aviso 1 (y 1 aviso más)');
});

test('la dirección a abrir solo puede ser una ruta de la propia aplicación', () => {
  for (const to of ['https://sitio-ajeno.example', '//sitio-ajeno.example', 'javascript:alert(1)', '/a b', undefined, null, 5]) {
    assert.equal(buildPayload([alert('1', { action: { to } })]).url, '/', String(to));
  }
  assert.equal(buildPayload([alert('1', { action: { to: '/logistics/packages/abc' } })]).url, '/logistics/packages/abc');
});

// ============================================================ la ronda
const sub = (o = {}) => ({ id: 's1', user_id: 'u1', endpoint: GOOD, p256dh: KEYS.p256dh, auth: KEYS.auth, last_pushed_at: null, sent_alert_ids: {}, ...o });
const harness = (rows, { alerts = [alert('a')], role = 'client', sendError = null } = {}) => {
  const db = fakeDb(rows);
  const sent = [];
  const calls = { alertsFor: [] };
  return {
    db, sent, calls,
    run: (over = {}) => runPushRound({
      db,
      send: async (s, payload) => { if (sendError) throw sendError; sent.push({ s, payload }); },
      getUser: async (id) => (role ? { id, role } : null),
      alertsFor: async (user) => { calls.alertsFor.push(user); return alerts; },
      now: NOW, log: { error() {} }, ...over,
    }),
  };
};

test('envía el aviso más urgente a la persona y lo marca como enviado', async () => {
  const h = harness([sub()], { alerts: [alert('x', { severity: 'high', title: 'Urgente' }), alert('y')] });
  assert.equal((await h.run()).sent, 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].payload.body, 'Urgente (y 1 aviso más)');
  assert.deepEqual(h.sent[0].s.keys, KEYS);
  assert.equal(h.db.state.rows[0].last_pushed_at, new Date(NOW).toISOString());
  assert.ok(h.db.state.rows[0].sent_alert_ids.x);
});

test('NO molesta: tras un aviso, el siguiente espera una hora (15 minutos si es urgente)', async () => {
  const recent = (ms) => [sub({ last_pushed_at: ago(ms), sent_alert_ids: { old: ago(ms) } })];
  assert.equal((await harness(recent(30 * 60 * 1000), { alerts: [alert('n')] }).run()).sent, 0, 'normal a los 30 min: espera');
  assert.equal((await harness(recent(HOUR_MS + 1000), { alerts: [alert('n')] }).run()).sent, 1, 'normal pasada la hora: sí');
  assert.equal((await harness(recent(10 * 60 * 1000), { alerts: [alert('n', { severity: 'high' })] }).run()).sent, 0, 'urgente a los 10 min: espera');
  assert.equal((await harness(recent(URGENT_GAP_MS + 1000), { alerts: [alert('n', { severity: 'high' })] }).run()).sent, 1, 'urgente pasados 15 min: sí');
});

test('nunca repite el mismo aviso en 24 horas, y pasadas 24 horas sí puede volver', async () => {
  const same = harness([sub({ last_pushed_at: ago(3 * HOUR_MS), sent_alert_ids: { a: ago(3 * HOUR_MS) } })], { alerts: [alert('a')] });
  assert.equal((await same.run()).sent, 0);
  const old = harness([sub({ last_pushed_at: ago(26 * HOUR_MS), sent_alert_ids: { a: ago(26 * HOUR_MS) } })], { alerts: [alert('a')] });
  assert.equal((await old.run()).sent, 1);
});

test('el cambio de estado de un paquete es un aviso NUEVO (otro id) y sí se envía', async () => {
  const h = harness([sub({ last_pushed_at: ago(2 * HOUR_MS), sent_alert_ids: { 'client_in_transit:p1:en_transito': ago(2 * HOUR_MS) } })], { alerts: [alert('client_delivered:p1:entregado')] });
  assert.equal((await h.run()).sent, 1);
});

test('el rol se resuelve en CADA ronda: una persona sin rol (cuenta borrada) no recibe nada y no se calculan sus avisos', async () => {
  const h = harness([sub()], { role: null });
  assert.equal((await h.run()).sent, 0);
  assert.equal(h.calls.alertsFor.length, 0);
});

test('los avisos se calculan con el rol de AHORA, no con uno guardado', async () => {
  const h = harness([sub()], { role: 'driver' });
  await h.run();
  assert.deepEqual(h.calls.alertsFor, [{ id: 'u1', role: 'driver' }]);
});

test('sin avisos no se envía nada', async () => {
  const h = harness([sub()], { alerts: [] });
  assert.equal((await h.run()).sent, 0);
  assert.equal(h.sent.length, 0);
});

test('una suscripción que el navegador ya no acepta (404 o 410) se borra; otro error no la borra', async () => {
  for (const code of [404, 410]) {
    const h = harness([sub()], { sendError: Object.assign(new Error('gone'), { statusCode: code }) });
    assert.equal((await h.run()).sent, 0);
    assert.equal(h.db.state.rows.length, 0, String(code));
  }
  const keep = harness([sub()], { sendError: Object.assign(new Error('fallo temporal'), { statusCode: 500 }) });
  await keep.run();
  assert.equal(keep.db.state.rows.length, 1);
  assert.equal(keep.db.state.rows[0].last_pushed_at, null, 'si no se entregó, no se marca como enviado');
});

test('varias personas, varios navegadores: cada uno recibe lo suyo y el fallo de una no frena a las demás', async () => {
  const rows = [sub({ id: 's1', user_id: 'u1' }), sub({ id: 's2', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/b' }), sub({ id: 's3', user_id: 'u2', endpoint: 'https://fcm.googleapis.com/fcm/send/c' })];
  const db = fakeDb(rows);
  const sent = [];
  const out = await runPushRound({
    db, now: NOW, log: { error() {} },
    send: async (s) => { sent.push(s.endpoint); },
    getUser: async (id) => { if (id === 'u1') throw new Error('Auth caído'); return { id, role: 'client' }; },
    alertsFor: async () => [alert('z')],
  });
  assert.deepEqual(sent, ['https://fcm.googleapis.com/fcm/send/c'], 'u1 falló al resolver el rol; u2 sí recibió');
  assert.equal(out.sent, 1);
});

test('sin la tabla la ronda se salta sola (no rompe el servidor)', async () => {
  const out = await runPushRound({ db: fakeDb([], { missing: true }), send: async () => {}, getUser: async () => null, alertsFor: async () => [], now: NOW });
  assert.deepEqual(out, { skipped: 'sin_tabla', sent: 0 });
});

// ============================================================ el controlador
const reply = () => { const r = { code: 200, body: null, ended: false }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => { r.ended = true; return r; }; return r; };

test('el controlador: suscribir (201), suscripción inválida (400 sin detalles), cancelar (204) y configuración', async () => {
  const db = fakeDb();
  controller._useDb(db);
  try {
    const user = { id: 'u1', role: 'client' };
    const ok = reply();
    await controller.handleSubscribe({ user, body: { endpoint: GOOD, keys: KEYS }, headers: { 'user-agent': 'x' } }, ok);
    assert.equal(ok.code, 201);
    const bad = reply();
    await controller.handleSubscribe({ user, body: { endpoint: 'http://169.254.169.254/', keys: KEYS }, headers: {} }, bad);
    assert.equal(bad.code, 400);
    assert.doesNotMatch(JSON.stringify(bad.body), /169|endpoint|zod/i);
    assert.equal(db.state.rows.length, 1, 'la dirección inválida no se guardó');
    const un = reply();
    await controller.handleUnsubscribe({ user, body: { endpoint: GOOD } }, un);
    assert.equal(un.code, 204);
    assert.equal(db.state.rows.length, 0);
    const cfg = reply();
    await controller.handleConfig({ user }, cfg);
    assert.equal(cfg.code, 200);
    assert.equal(typeof cfg.body.data.enabled, 'boolean');
  } finally { controller._useDb(null); }
});

test('el controlador sin la tabla responde 503 «no disponible»', async () => {
  controller._useDb(fakeDb([], { missing: true }));
  try {
    const r = reply();
    await controller.handleSubscribe({ user: { id: 'u1' }, body: { endpoint: GOOD, keys: KEYS }, headers: {} }, r);
    assert.equal(r.code, 503);
    assert.doesNotMatch(JSON.stringify(r.body), /relation|42P01|push_subscriptions/);
  } finally { controller._useDb(null); }
});

test('el límite de cambios es POR PERSONA (30 por hora)', async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] }; next(); });
  app.post('/', pushLimiter, (_req, r) => r.status(204).end());
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hit = (user) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/', headers: { 'x-user': user } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    const codes = [];
    for (let i = 0; i < 35; i += 1) codes.push(await hit('ana'));
    assert.equal(codes.filter((c) => c === 204).length, 30);
    assert.equal(await hit('beto'), 204);
  } finally { await new Promise((r) => server.close(r)); }
});
