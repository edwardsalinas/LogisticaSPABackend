import { Router } from 'express';
import { checkpointsController } from './checkpoints.controller.js';
import { requireAuth, requireRole } from '../iam/iam.middleware.js';

const router = Router();
router.use(requireAuth);

const canEdit = requireRole(['admin', 'logistics_operator']);

/**
 * @swagger
 * /api/logistics/routes/{routeId}/checkpoints:
 *   get:
 *     summary: Listar los checkpoints de una ruta (ordenados por secuencia)
 *     tags: [Checkpoints]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de checkpoints
 */
router.get('/routes/:routeId/checkpoints', checkpointsController.getByRoute.bind(checkpointsController));

/**
 * @swagger
 * /api/logistics/routes/{routeId}/checkpoints:
 *   post:
 *     summary: Crear un checkpoint en una ruta
 *     tags: [Checkpoints]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, lat, lng, sequence_order]
 *             properties:
 *               name: { type: string }
 *               lat: { type: number }
 *               lng: { type: number }
 *               radius_meters: { type: number, default: 100 }
 *               sequence_order: { type: integer }
 *     responses:
 *       201:
 *         description: Checkpoint creado
 *       403:
 *         description: Requiere rol admin o logistics_operator
 */
router.post('/routes/:routeId/checkpoints', canEdit, checkpointsController.create.bind(checkpointsController));

/**
 * @swagger
 * /api/logistics/routes/{routeId}/checkpoints/{checkpointId}:
 *   put:
 *     summary: Actualizar un checkpoint
 *     tags: [Checkpoints]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: checkpointId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Checkpoint actualizado
 *       403:
 *         description: Requiere rol admin o logistics_operator
 */
router.put('/routes/:routeId/checkpoints/:checkpointId', canEdit, checkpointsController.update.bind(checkpointsController));

/**
 * @swagger
 * /api/logistics/routes/{routeId}/checkpoints/{checkpointId}:
 *   delete:
 *     summary: Eliminar un checkpoint
 *     tags: [Checkpoints]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: checkpointId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Checkpoint eliminado
 *       403:
 *         description: Requiere rol admin o logistics_operator
 */
router.delete('/routes/:routeId/checkpoints/:checkpointId', canEdit, checkpointsController.delete.bind(checkpointsController));

/**
 * @swagger
 * /api/logistics/routes/{routeId}/checkpoints/reorder:
 *   post:
 *     summary: Reordenar los checkpoints de una ruta
 *     tags: [Checkpoints]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [checkpointIds]
 *             properties:
 *               checkpointIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Orden actualizado
 *       403:
 *         description: Requiere rol admin o logistics_operator
 */
router.post('/routes/:routeId/checkpoints/reorder', canEdit, checkpointsController.reorder.bind(checkpointsController));

export default router;
