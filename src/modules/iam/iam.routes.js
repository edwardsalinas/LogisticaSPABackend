import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import env from '../../shared/config/env.js';
import { requireAuth } from './iam.middleware.js';
import { requireCaptcha } from '../../shared/middlewares/captcha.js';
import { loginLimiter } from '../../shared/middlewares/rateLimit.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, parseCookies, setAuthCookies, clearAuthCookies } from './iam.cookies.js';

/**
 * Módulo IAM.
 * La gestión de usuarios, contraseñas y emisión de JWT la realiza Supabase Auth.
 * Este módulo solo actúa como intermediario: valida las credenciales contra Supabase,
 * entrega la sesión al navegador en cookies httpOnly y verifica el token en cada petición.
 */
const router = Router();

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

// Cliente local para el login. Usa la clave pública (anon): las operaciones de autenticación de un usuario
// no necesitan privilegios de Service Role. Si SUPABASE_ANON_KEY no está definida se usa la Service Role
// (compatibilidad) y se avisa una vez.
let warnedKey = false;
const createAuthClient = () => {
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_ANON_KEY && !warnedKey) {
    console.warn('[IAM] SUPABASE_ANON_KEY no definida: el login usa la Service Role Key. Define la clave anon para reducir el riesgo.');
    warnedKey = true;
  }
  return createClient(env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

/**
 * @swagger
 * /api/iam/login:
 *   post:
 *     summary: Iniciar sesión con email y password
 *     description: >
 *       Valida las credenciales con Supabase Auth y entrega la sesión en cookies httpOnly
 *       (`sb_access`, `sb_refresh`). Protegido con rate limiting y, si está configurado, captcha
 *       (header `x-captcha-token`).
 *     tags: [IAM]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso (cookies de sesión establecidas)
 *       400:
 *         description: Datos inválidos o captcha requerido
 *       401:
 *         description: Credenciales inválidas
 *       429:
 *         description: Demasiados intentos
 */
router.post('/login', loginLimiter, requireCaptcha, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
  }

  const { data, error } = await createAuthClient().auth.signInWithPassword(parsed.data);

  if (error) return res.status(401).json({ success: false, message: error.message });

  setAuthCookies(res, data.session);
  return res.status(200).json({
    success: true,
    data: { user: data.user, expires_at: data.session.expires_at },
  });
});

/**
 * @swagger
 * /api/iam/refresh:
 *   post:
 *     summary: Renovar la sesión usando la cookie de refresh
 *     tags: [IAM]
 *     responses:
 *       200:
 *         description: Sesión renovada (cookies actualizadas)
 *       401:
 *         description: Refresh token ausente o inválido
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
  if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token' });

  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ success: false, message: 'Forbidden: missing CSRF protection header' });
  }

  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    clearAuthCookies(res);
    return res.status(401).json({ success: false, message: error?.message || 'Sesión expirada' });
  }

  setAuthCookies(res, data.session);
  return res.json({ success: true, data: { user: data.user, expires_at: data.session.expires_at } });
});

/**
 * @swagger
 * /api/iam/logout:
 *   post:
 *     summary: Cerrar sesión (elimina las cookies de sesión)
 *     tags: [IAM]
 *     responses:
 *       200:
 *         description: Sesión cerrada
 */
router.post('/logout', (req, res) => {
  const hasSession = !!parseCookies(req.headers.cookie)[ACCESS_COOKIE];
  if (hasSession && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ success: false, message: 'Forbidden: missing CSRF protection header' });
  }
  clearAuthCookies(res);
  return res.json({ success: true });
});

/**
 * @swagger
 * /api/iam/profile:
 *   get:
 *     summary: Obtener perfil del usuario autenticado
 *     tags: [IAM]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Datos del perfil
 *       401:
 *         description: No autorizado
 */
router.get('/profile', requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

export default router;
