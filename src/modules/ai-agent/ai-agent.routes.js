import { Router } from 'express';
import * as AiAgentController from './ai-agent.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';

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
 *               message: { type: string, description: "La consulta o pregunta del usuario" }
 *     responses:
 *       201:
 *         description: Respuesta del asistente generada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: string }
 */
router.post('/chat', AiAgentController.handleChat);

export default router;
