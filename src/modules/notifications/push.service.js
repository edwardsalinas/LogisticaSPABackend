import { z } from 'zod';

/**
 * Avisos de Logi con la pestaña cerrada (Web Push). Voluntarios: solo recibe quien los activó en su navegador.
 *
 * Qué se envía: los MISMOS avisos de siempre (reglas fijas del servidor, sin modelo de lenguaje), calculados para cada persona con su rol
 * de AHORA (se vuelve a resolver en cada ronda, no se guarda: a quien perdió un permiso no le siguen llegando avisos del personal).
 *
 * Cómo no molestar: como mucho un aviso por hora (15 minutos si es urgente), nunca el mismo aviso dos veces en 24 horas, y la notificación
 * solo dice el título del aviso (no el texto con códigos ni nombres: la pantalla de bloqueo la ve cualquiera); el detalle está al abrirla.
 *
 * Seguridad: el servidor envía a la dirección que le dio el navegador. Si no se limitara, cualquier persona con sesión podría registrar
 * una dirección interna (http://169.254…, http://localhost…) y usar al servidor para llamarla (SSRF). Por eso solo se aceptan direcciones
 * https de los servicios de notificaciones conocidos de los navegadores, sin usuario, contraseña ni puerto.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const URGENT_GAP_MS = 15 * 60 * 1000;
export const DEDUPE_MS = 24 * HOUR_MS;
export const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_ROWS = 1000;

const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

export const isPushEndpoint = (value) => {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((s) => host.endsWith(s));
};

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, 'La dirección de notificaciones no es válida.'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

/** La tabla todavía no existe (falta aplicar la migración 023): la función se apaga sola en vez de romper. */
export const isMissingTable = (error) => {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return /42P01|PGRST205|push_subscriptions.*(does not exist|schema cache)|Could not find the table/i.test(text);
};

export const vapidConfigured = (env = process.env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

/** { enabled, publicKey }: ¿puede esta instalación enviar avisos? (claves configuradas Y tabla creada) */
export const pushStatus = async (db, env = process.env) => {
  if (!vapidConfigured(env)) return { enabled: false, reason: 'sin_claves' };
  // Una lectura normal, NO una consulta HEAD: una HEAD no trae cuerpo y sobre una tabla inexistente responde 204 sin error (parecería que existe).
  const { error } = await db.from('push_subscriptions').select('id').limit(1);
  if (error) return isMissingTable(error) ? { enabled: false, reason: 'sin_tabla' } : (() => { throw error; })();
  return { enabled: true, publicKey: env.VAPID_PUBLIC_KEY };
};

const unavailable = () => Object.assign(new Error('Los avisos con la pestaña cerrada no están disponibles en este servidor.'), { status: 503, expose: true });

export const saveSubscription = async (db, user, subscription, userAgent = null) => {
  const sub = subscriptionSchema.parse(subscription);
  const row = { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(userAgent ?? '').slice(0, 200) || null };
  // el mismo navegador (mismo endpoint) vuelve a activar: se actualiza y pasa a ser de quien lo activa ahora
  const { error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
  if (error) throw isMissingTable(error) ? unavailable() : error;
  // una persona no acumula navegadores: pasado el tope se descartan los más antiguos
  const { data: mine } = await db.from('push_subscriptions').select('id, created_at').eq('user_id', user.id).order('created_at', { ascending: false });
  const extra = (mine ?? []).slice(MAX_SUBSCRIPTIONS_PER_USER);
  if (extra.length) await db.from('push_subscriptions').delete().in('id', extra.map((e) => e.id));
};

/** Solo borra una suscripción de QUIEN la pide (una persona no puede desactivar la de otra). */
export const removeSubscription = async (db, user, endpoint) => {
  const { error } = await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', String(endpoint ?? ''));
  if (error) throw isMissingTable(error) ? unavailable() : error;
};

// ============================================================ qué se envía a cada persona
const safePath = (to) => (typeof to === 'string' && /^\/(?!\/)[^\s]*$/.test(to) ? to : '/');

/** Lo que se envía, a partir de los avisos nuevos de la persona (ya ordenados por urgencia). Función pura. */
export const buildPayload = (fresh) => {
  const [top] = fresh;
  const more = fresh.length - 1;
  return {
    title: 'Logi',
    body: more > 0 ? `${top.title} (y ${more} aviso${more === 1 ? '' : 's'} más)` : top.title,
    url: safePath(top.action?.to),
    tag: String(top.id),
    urgent: top.severity === 'high',
  };
};

const prune = (map, now) => Object.fromEntries(Object.entries(map ?? {}).filter(([, at]) => now - Date.parse(at) < DEDUPE_MS));

/**
 * Una ronda: para cada persona con suscripciones, calcula sus avisos y envía el más urgente si corresponde.
 * `send(subscription, payload)` y `getUser(id)` se inyectan (en producción: web-push y el administrador de Supabase Auth).
 */
export const runPushRound = async ({ db, send, getUser, alertsFor, now = Date.now(), log = console }) => {
  const { data: rows, error } = await db.from('push_subscriptions').select('*').limit(MAX_ROWS);
  if (error) {
    if (isMissingTable(error)) return { skipped: 'sin_tabla', sent: 0 };
    throw error;
  }
  const byUser = new Map();
  for (const r of rows ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  let sent = 0;
  for (const [userId, subs] of byUser) {
    try {
      const user = await getUser(userId);
      if (!user?.role) continue; // cuenta borrada o sin rol: nada que enviar (no se borran sus filas: puede ser un fallo pasajero)

      const sentIds = subs.reduce((acc, s) => ({ ...acc, ...prune(s.sent_alert_ids, now) }), {});
      const lastAt = Math.max(0, ...subs.map((s) => (s.last_pushed_at ? Date.parse(s.last_pushed_at) : 0)));
      const alerts = await alertsFor(user, db);
      const fresh = (alerts ?? []).filter((a) => a?.id && !sentIds[a.id]);
      if (!fresh.length) continue;

      const payload = buildPayload(fresh);
      if (now - lastAt < (payload.urgent ? URGENT_GAP_MS : HOUR_MS)) continue; // no molestar

      let delivered = false;
      for (const s of subs) {
        try {
          await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          delivered = true;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', s.id); // el navegador ya no la acepta
          else log.error?.('[Push] no se pudo enviar:', e?.statusCode ?? e?.message);
        }
      }
      if (delivered) {
        sent += 1;
        const marks = { ...sentIds, [fresh[0].id]: new Date(now).toISOString() };
        await db.from('push_subscriptions').update({ last_pushed_at: new Date(now).toISOString(), sent_alert_ids: marks }).eq('user_id', userId);
      }
    } catch (e) {
      log.error?.('[Push] error con un usuario:', e?.message);
    }
  }
  return { sent, users: byUser.size };
};
