-- 023: suscripciones de Web Push (avisos de Logi con la pestaña cerrada).
--
-- Cada fila es UN navegador de UNA persona que activó, de forma voluntaria, los avisos con la pestaña cerrada. El navegador
-- entrega la dirección (endpoint) y dos claves; con ellas el servidor puede enviarle una notificación cifrada.
--
--  * endpoint es único: reinstalar o volver a activar en el mismo navegador actualiza la fila, no la duplica.
--  * last_pushed_at y sent_alert_ids sirven para no molestar: como mucho un aviso por hora (15 minutos si es urgente) y nunca el mismo
--    aviso dos veces en 24 horas.
--  * Al borrar al usuario se borran sus suscripciones (ON DELETE CASCADE).
--
-- Idempotente: se puede ejecutar más de una vez. El backend usa la clave de servicio (omite RLS); al activar RLS sin políticas, ni
-- "anon" ni "authenticated" pueden leer esta tabla desde el navegador (las claves de cada suscripción son sensibles).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_pushed_at TIMESTAMPTZ,
  sent_alert_ids JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
