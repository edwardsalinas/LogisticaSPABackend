import { sendNotification, setVapidDetails } from 'web-push';
import supabase from '../../shared/config/supabase.js';
import { resolveRole } from '../iam/iam.middleware.js';
import { buildAlerts } from '../ai-agent/ai-agent.alerts.js';
import { runPushRound, vapidConfigured } from './push.service.js';

/** Lo que conecta el servicio de avisos con el mundo real: el envío (web-push), el rol actual de cada persona y el ciclo periódico. */
const ROUND_EVERY_MS = 10 * 60 * 1000;
const FIRST_ROUND_MS = 2 * 60 * 1000;

/** Envía UNA notificación cifrada (la biblioteca y el entorno se reciben para poder probarlo sin red). */
export const sendPush = async (subscription, payload, lib = { sendNotification, setVapidDetails }, env = process.env) => {
  lib.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  // TTL corto: un aviso de hace horas ya no sirve; «urgent» pide entrega inmediata
  return lib.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: payload.urgent ? 'high' : 'normal' });
};
const send = (subscription, payload) => sendPush(subscription, payload);

/** El rol de AHORA (de app_metadata, que solo escribe el servidor), nunca uno guardado antes. */
const getUser = async (id) => {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || !data?.user) return null;
  const role = resolveRole(data.user);
  return role ? { id, role, email: data.user.email } : null;
};

let running = false;
export const pushRound = async () => {
  if (running) return { skipped: 'en_curso' }; // una ronda lenta no se solapa con la siguiente
  running = true;
  try {
    return await runPushRound({ db: supabase, send, getUser, alertsFor: buildAlerts });
  } finally {
    running = false;
  }
};

export const startPushLoop = () => {
  if (!vapidConfigured()) {
    console.log('[Push] Sin claves VAPID: los avisos con la pestaña cerrada están apagados.');
    return;
  }
  const tick = () => pushRound().catch((e) => console.error('[Push] ronda fallida:', e?.message));
  setTimeout(() => { tick(); setInterval(tick, ROUND_EVERY_MS).unref?.(); }, FIRST_ROUND_MS).unref?.();
  console.log('[Push] Avisos con la pestaña cerrada activos (una ronda cada 10 minutos).');
};
