import { z } from 'zod';
import * as AiAgentService from './ai-agent.service.js';
import { confirmProposal, cancelProposal } from './ai-actions.service.js';
import { defaultExecutors } from './ai-actions.executors.js';
import supabase from '../../shared/config/supabase.js';
import { resolveConversation, saveTurn, listConversations, getConversation, deleteConversation } from './ai-conversations.service.js';
import { recordChat, recordLogiEvent, usageReport, LOGI_EVENTS } from './ai-audit.service.js';
import { buildAlerts } from './ai-agent.alerts.js';
import { prepareAssignProposal, prepareCreateProposal, prepareEventProposal } from './ai-agent.actions.js';
import { validateImage, extractFromImage } from './ai-agent.documents.js';

// Base de datos del historial y la auditoría (se puede sustituir en las pruebas)
let db = supabase;
export const _useDb = (replacement) => { db = replacement ?? supabase; };

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
  // conversación a la que pertenece el mensaje (si falta o no es del usuario, se abre una nueva)
  conversation_id: z.string().max(64).optional(),
});

/** Lo que se guarda tras una consulta: la conversación y la métrica de auditoría (nunca rompen la respuesta). */
export const afterAnswer = async ({ req, body, convo, out, started, streamed }) => {
  // Primero la conversación: la métrica la referencia por clave foránea. Si no se pudo guardar, la métrica queda sin ella.
  const saved = await saveTurn(db, req.user, convo, { question: body.message, answer: { text: out.text, attachments: out.attachments } });
  await recordChat(db, {
    userId: req.user?.id,
    role: req.user?.role,
    conversationId: saved ? convo.id : null,
    model: out.model,
    tools: [...new Set((out.trace?.tools ?? []).map((t) => t.name))],
    steps: out.trace?.steps,
    tokens: out.trace?.tokens,
    latencyMs: Date.now() - started,
    fastPath: out.trace?.fast,
    streamed,
    voice: body.voice,
    status: 'ok',
  });
};

const auditFailure = ({ req, body, convo, started, streamed, status }) =>
  recordChat(db, { userId: req.user?.id, role: req.user?.role, conversationId: null, latencyMs: Date.now() - started, streamed, voice: body?.voice, status: 'error', errorStatus: status });

export const handleChat = async (req, res) => {
  const started = Date.now();
  let body;
  let convoPromise;
  try {
    body = chatSchema.parse(req.body);
    // se comprueba la conversación EN PARALELO al trabajo del modelo: no suma tiempo a la respuesta
    convoPromise = resolveConversation(db, req.user, body.conversation_id);
    const out = await AiAgentService.processChatMessage(body.message, { user: req.user, history: body.history, voice: body.voice });
    const convo = await convoPromise;
    res.status(200).json({ success: true, response: out.text, attachments: out.attachments, model: out.model, conversation_id: convo.id });
    await afterAnswer({ req, body, convo, out, started, streamed: false }); // después de responder
    return undefined;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    }
    if (res.headersSent) return undefined;
    // No se devuelve error.message: puede incluir detalles del proveedor del LLM (claves, URLs)
    console.error('[AI Agent Controller Error]:', error);
    const busy = providerBusyStatus(error);
    await auditFailure({ req, body, convo: await convoPromise?.catch(() => null), started, streamed: false, status: busy ?? 500 });
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

const HEARTBEAT_MS = 15000;

/**
 * Chat con respuesta en vivo (Server-Sent Events sobre POST). Cada evento es una línea `data: {json}`:
 *   status | token | reset | final { response, attachments, model } | error { status, message }
 * Con la sesión por cookies no sirve EventSource (solo GET), por eso el cliente lo lee con fetch.
 */
export const handleChatStream = async (req, res) => {
  let body;
  try {
    body = chatSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    throw error;
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: no acumular la respuesta
  });
  res.flushHeaders();

  const started = Date.now();
  const convoPromise = resolveConversation(db, req.user, body.conversation_id);
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); }); // el usuario cerró la pestaña o canceló
  const send = (event) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, HEARTBEAT_MS);

  try {
    const out = await AiAgentService.processChatMessageStream(
      body.message,
      { user: req.user, history: body.history, voice: body.voice },
      { emit: send, signal: abort.signal },
    );
    const convo = await convoPromise;
    send({ type: 'final', response: out.text, attachments: out.attachments, model: out.model, conversation_id: convo.id });
    await afterAnswer({ req, body, convo, out, started, streamed: true }); // la pantalla ya tiene la respuesta
  } catch (error) {
    if (!abort.signal.aborted) {
      // No se devuelve error.message: puede incluir detalles del proveedor del LLM (claves, URLs)
      console.error('[AI Agent Stream Error]:', error);
      const busy = providerBusyStatus(error);
      await auditFailure({ req, body, convo: await convoPromise.catch(() => null), started, streamed: true, status: busy ?? 500 });
      send({
        type: 'error',
        status: busy ?? 500,
        message: busy
          ? 'El asistente está recibiendo muchas consultas. Espera un minuto e inténtalo de nuevo.'
          : 'No se pudo procesar la consulta. Inténtalo de nuevo.',
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};

// ============================================================ historial de conversaciones
const historyError = (res, error) => {
  console.error('[AI History Error]:', error);
  return res.status(500).json({ success: false, message: 'No se pudo cargar el historial.' });
};

export const handleListConversations = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await listConversations(db, req.user) });
  } catch (error) {
    return historyError(res, error);
  }
};

export const handleGetConversation = async (req, res) => {
  try {
    const found = await getConversation(db, req.user, req.params.id);
    if (!found) return res.status(404).json({ success: false, message: 'La conversación no existe.' });
    return res.status(200).json({ success: true, data: found });
  } catch (error) {
    return historyError(res, error);
  }
};

export const handleDeleteConversation = async (req, res) => {
  try {
    const removed = await deleteConversation(db, req.user, req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'La conversación no existe.' });
    return res.status(200).json({ success: true, message: 'Conversación eliminada.' });
  } catch (error) {
    return historyError(res, error);
  }
};

/** Panel de uso de la IA (solo administradores): métricas agregadas, sin el contenido de las conversaciones. */
export const handleUsage = async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const report = await usageReport(db, { days });
    const pool = AiAgentService.getPool();
    return res.status(200).json({ success: true, data: { ...report, pool: { strategy: pool.strategy, models: pool.status() } } });
  } catch (error) {
    console.error('[AI Usage Error]:', error);
    return res.status(500).json({ success: false, message: 'No se pudo calcular el uso de la IA.' });
  }
};

// ============================================================ avisos proactivos y eventos de Logi
/** Excepciones reales de la operación (retrasos, paquetes sueltos con viaje, viajes sin conductor). Solo personal. */
export const handleAlerts = async (req, res) => {
  try {
    const alerts = await buildAlerts(req.user, db);
    return res.status(200).json({ success: true, data: alerts });
  } catch (error) {
    console.error('[AI Alerts Error]:', error);
    return res.status(500).json({ success: false, message: 'No se pudieron calcular los avisos.' });
  }
};

const logiEventSchema = z.object({
  event: z.enum(LOGI_EVENTS),
  type: z.string().trim().max(40).regex(/^[a-z_]+$/).optional(),
});

/** Registra un evento de uso de Logi (solo métricas: qué pasó y de qué tipo, nunca contenido). */
export const handleLogiEvent = async (req, res) => {
  const parsed = logiEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
  await recordLogiEvent(db, { userId: req.user.id, role: req.user.role, ...parsed.data });
  return res.status(204).end();
};

// ============================================================ sugerencias: preparar una asignación sin pasar por el modelo
const prepareAssignmentSchema = z.object({
  route_ref: z.string().trim().min(1).max(64),
  codes: z.array(z.string().trim().min(3).max(64)).min(1).max(10),
});

/**
 * Convierte un grupo sugerido en una PROPUESTA (que el usuario confirma). Aplica exactamente las mismas comprobaciones
 * que la herramienta del agente (permisos, estado, viaje planeado, espacio), pero sin gastar una llamada al modelo.
 */
export const handlePrepareAssignment = async (req, res) => {
  let body;
  try {
    body = prepareAssignmentSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    throw error;
  }
  try {
    const result = await prepareAssignProposal(req.user, db, { codes: body.codes, route_ref: body.route_ref });
    let parsed = null;
    try { parsed = JSON.parse(result); } catch { /* es un mensaje de rechazo */ }
    if (parsed?.kind === 'action_proposal') return res.status(200).json({ success: true, data: parsed });
    const denied = /^No tienes permiso/.test(result);
    return res.status(denied ? 403 : 409).json({ success: false, message: String(result) });
  } catch (error) {
    console.error('[AI Suggestion Error]:', error);
    return res.status(500).json({ success: false, message: 'No se pudo preparar la asignación.' });
  }
};

// ============================================================ ayuda por voz: preparar un evento de seguimiento sin pasar por el modelo
const prepareEventSchema = z.object({
  codes: z.array(z.string().trim().min(3).max(64)).min(1).max(10),
  status: z.enum(['en_transito', 'en_agencia', 'siniestro']),
  note: z.string().trim().max(500).optional(),
});

/**
 * Convierte lo que la persona fue dictando (paquetes, estado, nota) en una PROPUESTA de evento a confirmar. Aplica exactamente
 * las mismas comprobaciones que la herramienta del agente (permisos, estados permitidos, paquetes que admiten el evento,
 * ubicación), pero sin gastar una llamada al modelo. Solo personal; no registra nada: la confirmación es aparte.
 */
export const handlePrepareEvent = async (req, res) => {
  let body;
  try {
    body = prepareEventSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    throw error;
  }
  try {
    const result = await prepareEventProposal(req.user, db, { codes: body.codes, status: body.status, note: body.note });
    let parsed = null;
    try { parsed = JSON.parse(result); } catch { /* es un mensaje de rechazo */ }
    if (parsed?.kind === 'action_proposal') return res.status(200).json({ success: true, data: parsed });
    const denied = /^No tienes permiso/.test(result);
    return res.status(denied ? 403 : 409).json({ success: false, message: String(result) });
  } catch (error) {
    console.error('[AI Event Proposal Error]:', error);
    return res.status(500).json({ success: false, message: 'No se pudo preparar el evento.' });
  }
};

// ============================================================ guías de remisión por foto
const OPS = ['admin', 'logistics_operator'];
const extractSchema = z.object({ image: z.string().min(20), mime: z.string().max(40).optional() });

/**
 * Lee una foto de guía de remisión y devuelve los campos que ve, para que una persona los revise y corrija.
 * No registra nada. La imagen no se guarda: solo se guarda la métrica de uso (modelo, tokens, tiempo).
 */
export const handleExtractDocument = async (req, res) => {
  const started = Date.now();
  if (!OPS.includes(req.user?.role)) return res.status(403).json({ success: false, message: 'No tienes permiso para leer documentos.' });
  let body;
  try {
    body = extractSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'No llegó ninguna imagen.' });
    throw error;
  }
  const image = validateImage(body);
  if (image.error) return res.status(image.status).json({ success: false, message: image.error });

  try {
    const out = await AiAgentService.getPool().extractDocument(image);
    await recordChat(db, { userId: req.user.id, role: req.user.role, model: out.model, tools: ['extract_document'], steps: 1, tokens: out.tokens, latencyMs: Date.now() - started, status: 'ok' });
    return res.status(200).json({ success: true, data: { fields: out.fields, missing: out.missing, warnings: out.warnings, model: out.model } });
  } catch (error) {
    console.error('[AI Document Error]:', error);
    const busy = providerBusyStatus(error);
    await recordChat(db, { userId: req.user.id, role: req.user.role, tools: ['extract_document'], latencyMs: Date.now() - started, status: 'error', errorStatus: busy ?? 500 });
    return res.status(busy ?? 500).json({
      success: false,
      message: busy ? 'El lector de documentos está muy ocupado. Inténtalo en un minuto.' : 'No se pudo leer el documento. Inténtalo con otra foto o completa los datos a mano.',
    });
  }
};

const proposeFromDocumentSchema = z.object({
  origen: z.string().trim().max(120),
  destino: z.string().trim().max(120),
  peso: z.number().positive().max(100000),
  recipient_name: z.string().trim().max(120),
  recipient_phone: z.string().trim().max(30).optional().nullable(),
  sender_name: z.string().trim().max(120).optional().nullable(),
  sender_phone: z.string().trim().max(30).optional().nullable(),
  description: z.string().trim().max(200).optional().nullable(),
});

/** Convierte los datos YA REVISADOS por la persona en una propuesta de registro (que se confirma con el botón de siempre). */
export const handleProposeFromDocument = async (req, res) => {
  let body;
  try {
    body = proposeFromDocumentSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    throw error;
  }
  try {
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v != null && v !== ''));
    const result = await prepareCreateProposal(req.user, db, clean);
    let parsed = null;
    try { parsed = JSON.parse(result); } catch { /* es un mensaje de rechazo */ }
    if (parsed?.kind === 'action_proposal') return res.status(200).json({ success: true, data: parsed });
    return res.status(/^No tienes permiso/.test(result) ? 403 : 409).json({ success: false, message: String(result) });
  } catch (error) {
    console.error('[AI Document Propose Error]:', error);
    return res.status(500).json({ success: false, message: 'No se pudo preparar el registro.' });
  }
};
