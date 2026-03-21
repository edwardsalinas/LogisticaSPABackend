import * as LogisticsService from './logistics.service.js';
import { packageSchema, routeSchema, assignmentSchema } from './logistics.schema.js';
import { z } from 'zod';

export const handleCreatePackage = async (req, res) => {
  try {
    const validatedData = packageSchema.parse(req.body);
    const senderId = validatedData.sender_id || req.user.id;
    const result = await LogisticsService.createPackage(validatedData, senderId);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetPackages = async (req, res) => {
  try {
    const filters = { ...req.query };
    
    // Si es cliente, forzar filtro por su propio ID
    if (req.user.role === 'client') {
      filters.sender_id = req.user.id;
    }

    const result = await LogisticsService.getPackages(filters);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetRoutes = async (req, res) => {
  try {
    const filters = { ...req.query };
    
    // Si es conductor, solo ve sus propias rutas asignadas
    if (req.user.role === 'driver') {
      filters.driver_id = req.user.id;
    }

    const result = await LogisticsService.getRoutes(filters);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleCreateRoute = async (req, res) => {
  try {
    const validatedData = routeSchema.parse(req.body);
    const result = await LogisticsService.createRoute(validatedData);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleAssignPackage = async (req, res) => {
  try {
    const { package_id, route_id } = assignmentSchema.parse({
      package_id: req.body.package_id,
      route_id: req.params.id
    });
    const result = await LogisticsService.assignPackageToRoute(package_id, route_id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetPredefinedRoutes = async (req, res) => {
  try {
    const result = await LogisticsService.getPredefinedRoutes();
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleUpdateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const validatedData = routeSchema.partial().parse(req.body);
    const result = await LogisticsService.updateRoute(id, validatedData);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleDeleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    await LogisticsService.deleteRoute(id);
    return res.status(200).json({ success: true, message: 'Ruta eliminada correctamente' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetRoute = async (req, res) => {
  try {
    const result = await LogisticsService.getRoute(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Ruta no encontrada' });

    // Validate that drivers can only view their own assigned routes
    if (req.user.role === 'driver' && result.driver_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Acceso denegado a esta ruta' });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
