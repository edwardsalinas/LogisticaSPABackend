import { z } from 'zod';
import supabase from '../../shared/config/supabase.js';
import { pushStatus, saveSubscription, removeSubscription, sendTestPush } from './push.service.js';
import { publicError } from '../../shared/errors/publicError.js';

let db = supabase;
export const _useDb = (replacement) => { db = replacement ?? supabase; };

/** ¿Se pueden activar los avisos con la pestaña cerrada en este servidor? Si sí, entrega la clave pública que el navegador necesita. */
export const handleConfig = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await pushStatus(db) });
  } catch (error) {
    { const out = publicError(error); return res.status(out.status).json({ success: false, message: out.message }); }
  }
};

export const handleSubscribe = async (req, res) => {
  try {
    await saveSubscription(db, req.user, req.body, req.headers['user-agent']);
    return res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'La suscripción no es válida.' });
    { const out = publicError(error); return res.status(out.status).json({ success: false, message: out.message }); }
  }
};

// El envío real (web-push) se carga al usarse: así el controlador no depende de la biblioteca ni de las claves al importarse (y se puede probar).
let sender = null;
export const _useSender = (fn) => { sender = fn ?? null; };
const getSender = async () => sender ?? (await import('./push.runtime.js')).sendPush;

/** Manda una notificación de prueba a los navegadores de quien la pide. */
export const handleTest = async (req, res) => {
  try {
    const out = await sendTestPush({ db, user: req.user, send: await getSender() });
    if (out.sent === 0) return res.status(502).json({ success: false, message: 'No se pudo enviar la prueba. Desactiva y vuelve a activar los avisos en este navegador.' });
    return res.status(200).json({ success: true, data: out });
  } catch (error) {
    { const out = publicError(error); return res.status(out.status).json({ success: false, message: out.message }); }
  }
};

export const handleUnsubscribe = async (req, res) => {
  try {
    await removeSubscription(db, req.user, req.body?.endpoint);
    return res.status(204).end();
  } catch (error) {
    { const out = publicError(error); return res.status(out.status).json({ success: false, message: out.message }); }
  }
};
