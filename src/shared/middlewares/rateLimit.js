import rateLimit from 'express-rate-limit';

/**
 * Rate limiting (mitigación de fuerza bruta, scraping y DDoS de capa de aplicación).
 * Los límites son por IP. Detrás de un proxy/balanceador configurar TRUST_PROXY (ver app.js).
 * Para mitigar DDoS volumétrico se recomienda además un CDN/WAF delante (ej. Cloudflare).
 */
const buildLimiter = ({ windowMs, limit, message, ...extra }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ success: false, code: 'RATE_LIMITED', message }),
    ...extra,
  });

/** Límite general para toda la API. */
export const apiLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_API_MAX) || 600,
  message: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.',
});

/** Login: 10 intentos fallidos por IP cada 15 minutos (los exitosos no cuentan). */
export const loginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10,
  skipSuccessfulRequests: true,
  message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.',
});

/** Rastreo público anónimo: evita enumerar códigos de seguimiento. */
export const publicTrackingLimiter = buildLimiter({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PUBLIC_MAX) || 20,
  message: 'Demasiadas consultas de rastreo. Espera un minuto e intenta de nuevo.',
});

/** Chat con IA: cada mensaje consume tokens del proveedor de LLM. */
export const chatLimiter = buildLimiter({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_CHAT_MAX) || 15,
  message: 'Demasiados mensajes al asistente. Espera un minuto.',
});
