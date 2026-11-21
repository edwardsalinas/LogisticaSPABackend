/**
 * Verificación de CAPTCHA (Cloudflare Turnstile) para endpoints públicos o sensibles.
 *
 * - Si TURNSTILE_SECRET_KEY no está definida, el middleware queda deshabilitado
 *   (útil en desarrollo local) y deja pasar la petición.
 * - El token se recibe en el header `x-captcha-token` o en `body.captchaToken`.
 * - Los tokens de Turnstile son de un solo uso: el frontend debe pedir uno nuevo en cada intento.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
let warned = false;

export const requireCaptcha = async (req, res, next) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (!warned) {
      console.warn('[Captcha] TURNSTILE_SECRET_KEY no definida: verificación de captcha deshabilitada.');
      warned = true;
    }
    return next();
  }

  const token = req.headers['x-captcha-token'] || req.body?.captchaToken;
  if (!token) {
    return res.status(400).json({ success: false, code: 'CAPTCHA_REQUIRED', message: 'Completa la verificación de seguridad (captcha).' });
  }

  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    if (req.ip) body.set('remoteip', req.ip);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();

    if (!result.success) {
      return res.status(403).json({ success: false, code: 'CAPTCHA_INVALID', message: 'La verificación de seguridad falló. Inténtalo de nuevo.' });
    }
    return next();
  } catch (error) {
    // Si no se puede verificar, se rechaza (fail closed) para no abrir el endpoint.
    console.error('[Captcha] Error verificando token:', error.message);
    return res.status(503).json({ success: false, code: 'CAPTCHA_UNAVAILABLE', message: 'No se pudo verificar el captcha. Intenta más tarde.' });
  }
};
