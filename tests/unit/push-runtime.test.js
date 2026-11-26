import './_env.js';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Carga el archivo REAL que arranca con el servidor (envío con web-push, rol actual, ciclo): un error de importación aquí tumba el servidor
// entero y las pruebas con bases simuladas no lo verían.
const runtime = await import('../../src/modules/notifications/push.runtime.js');

test('el módulo de envío se carga y expone lo que usa el servidor', () => {
  assert.equal(typeof runtime.startPushLoop, 'function');
  assert.equal(typeof runtime.pushRound, 'function');
});

test('sin claves VAPID el ciclo NO se programa (la función queda apagada y no deja temporizadores)', () => {
  const saved = { a: process.env.VAPID_PUBLIC_KEY, b: process.env.VAPID_PRIVATE_KEY, c: process.env.VAPID_SUBJECT };
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  const timeout = mock.method(globalThis, 'setTimeout', () => ({ unref() {} }));
  const log = mock.method(console, 'log', () => {});
  try {
    runtime.startPushLoop();
    assert.equal(timeout.mock.calls.length, 0);
    assert.match(String(log.mock.calls[0]?.arguments[0]), /Sin claves VAPID/);
  } finally {
    timeout.mock.restore(); log.mock.restore();
    if (saved.a) process.env.VAPID_PUBLIC_KEY = saved.a; if (saved.b) process.env.VAPID_PRIVATE_KEY = saved.b; if (saved.c) process.env.VAPID_SUBJECT = saved.c;
  }
});

test('con las tres claves el ciclo se programa una vez', () => {
  Object.assign(process.env, { VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:a@b.c' });
  const timeout = mock.method(globalThis, 'setTimeout', () => ({ unref() {} }));
  const log = mock.method(console, 'log', () => {});
  try {
    runtime.startPushLoop();
    assert.equal(timeout.mock.calls.length, 1);
  } finally {
    timeout.mock.restore(); log.mock.restore();
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  }
});

// ============================================================ el envío real (biblioteca web-push, sin red)
import crypto from 'node:crypto';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push';

const browserSubscription = () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/prueba', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};

test('sendPush: claves VAPID válidas, cuerpo CIFRADO (no texto plano) y tiempo de vida y urgencia correctos', async () => {
  const vapid = generateVAPIDKeys();
  const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:soporte@logistica.example' };
  const captured = [];
  const lib = {
    setVapidDetails: (...a) => captured.push(['vapid', ...a]),
    sendNotification: async (sub, body, opts) => { captured.push(['send', sub, body, opts]); return generateRequestDetails(sub, body, { ...opts, vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } }); },
  };
  const sub = browserSubscription();
  const payload = { title: 'Logi', body: 'Hay paquetes con siniestro', url: '/tracking', tag: 'a1', urgent: true };
  const details = await runtime.sendPush(sub, payload, lib, env);

  assert.deepEqual(captured[0], ['vapid', env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY]);
  assert.deepEqual(captured[1][3], { TTL: 3600, urgency: 'high' });
  assert.equal(JSON.parse(captured[1][2]).body, 'Hay paquetes con siniestro');
  assert.match(details.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(String(details.headers.TTL), '3600');
  assert.equal(details.headers.Urgency, 'high');
  assert.ok(Buffer.isBuffer(details.body) && details.body.length > 0);
  assert.equal(details.body.toString('utf8').includes('siniestro'), false, 'el cuerpo viaja cifrado: ni el servicio de notificaciones lo lee');
  assert.equal(details.endpoint, sub.endpoint);
});

test('un aviso normal pide urgencia normal', async () => {
  const seen = [];
  await runtime.sendPush(browserSubscription(), { title: 'Logi', body: 'x', urgent: false }, { setVapidDetails() {}, sendNotification: async (_s, _b, o) => seen.push(o) }, { VAPID_SUBJECT: 's', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' });
  assert.deepEqual(seen[0], { TTL: 3600, urgency: 'normal' });
});

test('las claves VAPID de ESTA instalación (.env) son válidas para la biblioteca', () => {
  if (!process.env.VAPID_PUBLIC_KEY) return; // el entorno de pruebas puede no traerlas
  assert.doesNotThrow(() => generateRequestDetails(browserSubscription(), '{}', { vapidDetails: { subject: process.env.VAPID_SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } }));
});
