import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import env from '../../shared/config/env.js';
import supabase from '../../shared/config/supabase.js';
import { requireAuth } from './iam.middleware.js';

const router = Router();

/**
 * @swagger
 * /api/iam/login:
 *   post:
 *     summary: Iniciar sesión con email y password
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
 *         description: Login exitoso
 *       401:
 *         description: Credenciales inválidas
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Creamos un cliente local para el login para evitar contaminar el singleton del Service Role
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  
  if (error) return res.status(401).json({ success: false, message: error.message });
  return res.status(200).json({ success: true, data });
});

/**
 * @swagger
 * /api/iam/profile:
 *   get:
 *     summary: Obtener perfil del usuario autenticado
 *     tags: [IAM]
 *     security:
 *       - bearerAuth: []
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
