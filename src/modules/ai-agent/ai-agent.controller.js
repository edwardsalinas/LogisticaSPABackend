import { z } from 'zod';
import * as AiAgentService from './ai-agent.service.js';

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
    .max(10)
    .optional(),
});

export const handleChat = async (req, res) => {
  try {
    const { message, history } = chatSchema.parse(req.body);
    const response = await AiAgentService.processChatMessage(message, { user: req.user, history });
    return res.status(200).json({ success: true, response });
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
