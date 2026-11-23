import { randomUUID } from 'node:crypto';

/**
 * Historial de conversaciones del asistente.
 *
 * Reglas de seguridad: toda lectura, escritura y borrado se filtra por el DUEÑO (user_id = el usuario autenticado).
 * Una conversación ajena se trata como inexistente (no se revela que exista). Guardar el historial nunca debe romper
 * el chat: los errores de persistencia se registran y se ignoran.
 */
export const MAX_TITLE = 60;
export const MAX_CONTENT = 8000;
export const LIST_LIMIT = 30;
export const MAX_MESSAGES_LOADED = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Título de una conversación: la primera pregunta, en una línea y acotada. */
export const titleFrom = (question) => {
  const t = String(question ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Nueva conversación';
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
};

/**
 * Decide a qué conversación pertenece este turno SIN esperar a la base de datos para responder:
 * si el cliente indicó una conversación se comprueba que sea suya (en paralelo al trabajo del modelo);
 * si no, se reserva un identificador nuevo que se crea al guardar.
 * @returns {Promise<{ id: string, isNew: boolean }>}
 */
export const resolveConversation = async (db, user, requestedId) => {
  if (isUuid(requestedId)) {
    try {
      const { data } = await db.from('ai_conversations').select('id').eq('id', requestedId).eq('user_id', user.id).maybeSingle();
      if (data) return { id: data.id, isNew: false };
    } catch (e) {
      console.error('[AI History] No se pudo comprobar la conversación:', e.message);
    }
  }
  return { id: randomUUID(), isNew: true };
};

// Marcas de tiempo estrictamente crecientes: dos turnos seguidos nunca se desordenan, ni en el mismo milisegundo
let lastStamp = 0;
const nextStamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 2); return lastStamp; };

/** Guarda la pregunta y la respuesta de un turno (y crea la conversación si es nueva). Nunca lanza. */
export const saveTurn = async (db, user, convo, { question, answer }) => {
  try {
    if (convo.isNew) {
      const { error } = await db.from('ai_conversations').insert({ id: convo.id, user_id: user.id, title: titleFrom(question) });
      if (error) throw error;
    }
    const clip = (s) => String(s ?? '').slice(0, MAX_CONTENT);
    const base = nextStamp();
    const { error } = await db.from('ai_messages').insert([
      // las dos filas llevan las mismas columnas: en un insert múltiple PostgREST pone NULL en las que faltan y rompería NOT NULL
      { conversation_id: convo.id, role: 'user', content: clip(question), attachments: [], is_error: false, created_at: new Date(base).toISOString() },
      {
        conversation_id: convo.id,
        role: 'assistant',
        content: clip(answer.text),
        attachments: answer.attachments ?? [],
        is_error: !!answer.isError,
        created_at: new Date(base + 1).toISOString(), // siempre después de la pregunta
      },
    ]);
    if (error) throw error;
    if (!convo.isNew) await db.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convo.id).eq('user_id', user.id);
    return true;
  } catch (e) {
    console.error('[AI History] No se pudo guardar la conversación:', e.message);
    return false;
  }
};

export const listConversations = async (db, user, { limit = LIST_LIMIT } = {}) => {
  const { data, error } = await db
    .from('ai_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(1, Number(limit) || LIST_LIMIT), 100));
  if (error) throw error;
  return data ?? [];
};

/** La conversación con sus mensajes, o null si no existe o no es del usuario. */
export const getConversation = async (db, user, id) => {
  if (!isUuid(id)) return null;
  const { data: conversation, error } = await db.from('ai_conversations').select('id, title, created_at, updated_at').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!conversation) return null;
  const { data: messages, error: msgError } = await db
    .from('ai_messages')
    .select('id, role, content, attachments, is_error, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES_LOADED);
  if (msgError) throw msgError;
  return { conversation, messages: messages ?? [] };
};

/** Borra una conversación propia (y sus mensajes, en cascada). Devuelve false si no existe o no es suya. */
export const deleteConversation = async (db, user, id) => {
  if (!isUuid(id)) return false;
  const { data, error } = await db.from('ai_conversations').delete().eq('id', id).eq('user_id', user.id).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
};
