import { checkpointsService } from './checkpoints.service.js';

export const checkpointsController = {
  /**
   * GET /api/logistics/routes/:routeId/checkpoints
   */
  async getByRoute(req, res, next) {
    try {
      const { routeId } = req.params;
      const checkpoints = await checkpointsService.getByRouteId(routeId);
      res.json({ data: checkpoints });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/logistics/routes/:routeId/checkpoints
   */
  async create(req, res, next) {
    try {
      const { routeId } = req.params;
      const checkpoint = await checkpointsService.create(routeId, req.body);
      res.status(201).json({ data: checkpoint });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/logistics/routes/:routeId/checkpoints/:checkpointId
   */
  async update(req, res, next) {
    try {
      const { routeId, checkpointId } = req.params;
      const checkpoint = await checkpointsService.update(routeId, checkpointId, req.body);
      res.json({ data: checkpoint });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/logistics/routes/:routeId/checkpoints/:checkpointId
   */
  async delete(req, res, next) {
    try {
      const { routeId, checkpointId } = req.params;
      await checkpointsService.delete(routeId, checkpointId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/logistics/routes/:routeId/checkpoints/reorder
   */
  async reorder(req, res, next) {
    try {
      const { routeId } = req.params;
      const { checkpointIds } = req.body;
      await checkpointsService.reorder(routeId, checkpointIds);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
};
