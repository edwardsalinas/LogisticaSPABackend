import { z } from 'zod';
import supabase from '../../shared/config/supabase.js';
import { pushStatus, saveSubscription, removeSubscription } from './push.service.js';
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

export const handleUnsubscribe = async (req, res) => {
  try {
    await removeSubscription(db, req.user, req.body?.endpoint);
    return res.status(204).end();
  } catch (error) {
    { const out = publicError(error); return res.status(out.status).json({ success: false, message: out.message }); }
  }
};
