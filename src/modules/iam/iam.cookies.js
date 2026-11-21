/**
 * Manejo de cookies de sesión (httpOnly).
 *
 * El JWT de Supabase Auth ya no viaja al JavaScript del navegador: se entrega en una cookie
 * `httpOnly`, por lo que un ataque XSS no puede leerlo. Se mantiene el header
 * `Authorization: Bearer` como alternativa para clientes de API (Postman, scripts).
 *
 * Variables de entorno:
 *   COOKIE_SECURE    'true' | 'false'  (por defecto: true cuando NODE_ENV=production)
 *   COOKIE_SAMESITE  'lax' | 'strict' | 'none' (por defecto 'lax'; usar 'none' + HTTPS si el
 *                    frontend y la API están en sitios distintos)
 *   COOKIE_DOMAIN    (opcional)
 */
export const ACCESS_COOKIE = 'sb_access';
export const REFRESH_COOKIE = 'sb_refresh';

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

const isSecure = () => {
  if (process.env.COOKIE_SECURE !== undefined) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
};

const baseOptions = () => {
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const opts = {
    httpOnly: true,
    // SameSite=None exige Secure; los navegadores rechazan la cookie en caso contrario.
    secure: sameSite === 'none' ? true : isSecure(),
    sameSite,
    path: '/',
  };
  if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
};

/** Parser mínimo de la cabecera Cookie (evita agregar una dependencia). */
export const parseCookies = (header = '') => {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
};

export const setAuthCookies = (res, session) => {
  const accessMaxAge = Math.max((session.expires_in ?? 3600), 60) * 1000;
  res.cookie(ACCESS_COOKIE, session.access_token, { ...baseOptions(), maxAge: accessMaxAge });
  if (session.refresh_token) {
    res.cookie(REFRESH_COOKIE, session.refresh_token, { ...baseOptions(), maxAge: REFRESH_MAX_AGE_MS });
  }
};

export const clearAuthCookies = (res) => {
  const { maxAge, ...opts } = baseOptions();
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
};
