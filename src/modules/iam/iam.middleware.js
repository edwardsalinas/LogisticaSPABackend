import * as IamService from './iam.service.js';
import { ACCESS_COOKIE, parseCookies } from './iam.cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let warnedLegacyRole = false;

/**
 * Rol del usuario. La fuente confiable es `app_metadata.role`, que SOLO puede escribir el servidor
 * (service role). `user_metadata` lo puede modificar el propio usuario con supabase.auth.updateUser(),
 * por lo que nunca debería definir privilegios.
 *
 * Transición: mientras existan usuarios con el rol en `user_metadata`, AUTH_ALLOW_USER_METADATA_ROLE
 * (por defecto activo) permite ese respaldo. Ejecuta `node --env-file=.env scripts/migrate-roles-to-app-metadata.js`
 * y luego define AUTH_ALLOW_USER_METADATA_ROLE=false para cerrar la brecha.
 */
export const resolveRole = (user, allowLegacy = process.env.AUTH_ALLOW_USER_METADATA_ROLE !== 'false') => {
  const trusted = user?.app_metadata?.role;
  if (trusted) return trusted;
  if (allowLegacy && user?.user_metadata?.role) {
    if (!warnedLegacyRole) {
      console.warn('[IAM] Rol leído de user_metadata (editable por el usuario). Migra los roles a app_metadata y define AUTH_ALLOW_USER_METADATA_ROLE=false.');
      warnedLegacyRole = true;
    }
    return user.user_metadata.role;
  }
  return 'client';
};

/**
 * Middleware de Autenticación (IAM)
 * Verifica el JWT de Supabase Auth. Acepta dos orígenes del token:
 *   1. Cookie httpOnly `sb_access` (navegador / SPA).
 *   2. Header `Authorization: Bearer <jwt>` (clientes de API).
 *
 * Protección CSRF: cuando el token llega por cookie, las peticiones que modifican datos
 * deben incluir el header `X-Requested-With: XMLHttpRequest`. Un formulario de otro sitio no
 * puede enviar ese header, y CORS (con lista de orígenes) impide hacerlo con fetch/XHR.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    let fromCookie = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = parseCookies(req.headers.cookie)[ACCESS_COOKIE] || null;
      fromCookie = !!token;
    }

    if (!token) {
      return res.status(401).json({ message: 'No authorization token provided' });
    }

    if (fromCookie && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ message: 'Forbidden: missing CSRF protection header' });
    }

    const user = await IamService.verifyToken(token);

    if (!user) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    req.user = user;
    req.user.role = resolveRole(user);
    next();
  } catch (error) {
    console.error('[IAM Middleware] Authentication error:', error.message || error);
    // No se devuelve error.message: puede exponer detalles internos del proveedor de autenticación
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/**
 * Middleware de Autorización (RBAC)
 * Verifica si el usuario tiene uno de los roles permitidos.
 */
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const userRole = req.user.role || resolveRole(req.user);

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
    }

    next();
  };
};
