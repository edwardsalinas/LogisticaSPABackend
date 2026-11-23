-- 022: historial de conversaciones del asistente de IA y auditoría de cada consulta.
--
--  * ai_conversations / ai_messages: las conversaciones de cada usuario, para continuarlas después de recargar la
--    página o desde otro dispositivo. Cada conversación pertenece a UN usuario (el backend filtra por dueño).
--  * ai_chat_audit: una fila por consulta con MÉTRICAS (modelo, herramientas, pasos, tokens, tiempo, estado). No guarda
--    el texto de la pregunta ni de la respuesta: sirve para el panel de uso sin exponer el contenido de los usuarios.
--
-- Idempotente: se puede ejecutar más de una vez. El backend usa la clave de servicio (omite RLS); al activar RLS sin
-- políticas, ni "anon" ni "authenticated" pueden leer estas tablas directamente desde el navegador.

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nueva conversación',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated ON public.ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_error BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ai_conversations y ai_messages ya podían existir (vacías) de una versión anterior, con `metadata` en vez de estas columnas:
-- se completan sin borrar nada.
ALTER TABLE public.ai_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ai_messages ADD COLUMN IF NOT EXISTS is_error BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON public.ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.ai_chat_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role TEXT,
  conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  model TEXT,
  tools TEXT[] NOT NULL DEFAULT '{}',
  steps INTEGER,
  tokens INTEGER,
  latency_ms INTEGER,
  fast_path BOOLEAN NOT NULL DEFAULT false,
  streamed BOOLEAN NOT NULL DEFAULT false,
  voice BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_audit_created ON public.ai_chat_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_audit_user_created ON public.ai_chat_audit (user_id, created_at DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_audit ENABLE ROW LEVEL SECURITY;
