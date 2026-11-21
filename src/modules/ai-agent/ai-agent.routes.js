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

/**
 * @swagger
 * /api/ai-agent/actions/{id}/confirm:
 *   post:
 *     summary: Confirmar una acción propuesta por el asistente (ejecuta el cambio)
 *     description: El asistente solo PROPONE acciones (registrar evento, entregar paquete, crear paquete). Esta llamada, hecha por el usuario con su sesión, es lo único que las ejecuta. Es de un solo uso, caduca a los 10 minutos y solo la puede confirmar quien la originó.
 *     tags: [AI Agent]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Acción ejecutada }
 *       403: { description: Sin permiso para esa acción }
 *       404: { description: La acción no existe, no es tuya o ya no está disponible }
 *       409: { description: La acción ya se ejecutó o se canceló }
 *       410: { description: La acción venció }
 */
router.post('/actions/:id/confirm', AiAgentController.handleConfirmAction);

/**
 * @swagger
 * /api/ai-agent/actions/{id}/cancel:
 *   post:
 *     summary: Cancelar una acción propuesta por el asistente (no se hace ningún cambio)
 *     tags: [AI Agent]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Acción cancelada }
 *       404: { description: La acción no existe o no es tuya }
 *       409: { description: La acción ya no se puede cancelar }
 */
router.post('/actions/:id/cancel', AiAgentController.handleCancelAction);

export default router;
