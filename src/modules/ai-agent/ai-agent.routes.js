import { Router } from 'express';
import * as AiAgentController from './ai-agent.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';
import { chatLimiter } from '../../shared/middlewares/rateLimit.js';

const router = Router();
router.use(requireAuth);

/**
 * @swagger
 * /api/ai-agent/chat:
 *   post:
 *     summary: Consultar al asistente logístico con IA
 *     tags: [AI Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 1000, description: "La consulta o pregunta del usuario" }
 *               history:
 *                 type: array
 *                 maxItems: 10
 *                 description: "Mensajes previos de la conversación (contexto)"
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string }
 *     responses:
 *       200:
 *         description: Respuesta del asistente generada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 response: { type: string }
 *       400:
 *         description: Mensaje inválido
 *       429:
 *         description: Demasiados mensajes
 */
router.post('/chat', chatLimiter, AiAgentController.handleChat);

export default router;
