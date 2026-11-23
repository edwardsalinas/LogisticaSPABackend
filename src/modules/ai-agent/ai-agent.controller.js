import { z } from 'zod';
import * as AiAgentService from './ai-agent.service.js';
import { confirmProposal, cancelProposal } from './ai-actions.service.js';
import { defaultExecutors } from './ai-actions.executors.js';

// Entrada validada: mensaje acotado e historial reciente (solo roles user/assistant, tamaño limitado)
/**
 * El proveedor del LLM limita las peticiones (429: cuota; 503: saturado). Se informa como 429/503 y no como un
 * error interno, para que el cliente pueda avisar al usuario que reintente.
 */
export const providerBusyStatus = (error) => {
  const status = Number(error?.status ?? error?.response?.status);
  return status === 429 ? 429 : status === 503 ? 503 : null;
};

export const chatSchema = z.object({
  message: z.string().trim().min(1, "El campo 'message' es requerido").max(1000, 'El mensaje no puede superar 1000 caracteres'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      })
    )
    .max(16)
    .optional(),
  // true cuando el usuario habla con el asistente: la respuesta se leerá en voz alta y debe ser corta y hablada
  voice: z.boolean().optional(),
});

export const handleChat = async (req, res) => {
  try {
    const { message, history, voice } = chatSchema.parse(req.body);
    const { text, attachments, model } = await AiAgentService.processChatMessage(message, { user: req.user, history, voice });
    return res.status(200).json({ success: true, response: text, attachments, model });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    }
    // No se devuelve error.message: puede incluir detalles del proveedor del LLM (claves, URLs)
    console.error('[AI Agent Controller Error]:', error);
    const busy = providerBusyStatus(error);
    if (busy) {
      return res.status(busy).json({ success: false, message: 'El asistente está recibiendo muchas consultas. Espera un minuto e inténtalo de nuevo.' });
    }
    return res.status(500).json({ success: false, message: 'No se pudo procesar la consulta. Inténtalo de nuevo.' });
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Respuesta común de los endpoints de acciones: los errores con status propio se muestran, el resto es genérico. */
const actionError = (res, error) => {
  if (error.status && error.status < 500) return res.status(error.status).json({ success: false, message: error.message });
  console.error('[AI Action Error]:', error);
  return res.status(500).json({ success: false, message: 'No se pudo ejecutar la acción. Inténtalo de nuevo o hazlo desde la pantalla correspondiente.' });
};

/** El usuario confirmó una propuesta del asistente: se ejecuta con SU sesión y sus permisos. */
export const handleConfirmAction = async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'La acción no existe o ya no está disponible' });
    const result = await confirmProposal(req.params.id, req.user, defaultExecutors);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    return actionError(res, error);
  }
};

export const handleCancelAction = async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'La acción no existe o ya no está disponible' });
    return res.status(200).json({ success: true, result: cancelProposal(req.params.id, req.user) });
  } catch (error) {
    return actionError(res, error);
  }
};

/** Estado de los modelos del balanceador (solo administradores): carga, latencia y enfriamientos. Sin claves. */
export const handlePoolStatus = (_req, res) => {
  const pool = AiAgentService.getPool();
  return res.status(200).json({ success: true, data: { strategy: pool.strategy, models: pool.status() } });
};
