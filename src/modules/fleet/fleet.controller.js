import * as FleetService from './fleet.service.js';
import { vehicleSchema, driverSchema } from './fleet.schema.js';
import { z } from 'zod';

export const handleCreateVehicle = async (req, res) => {
  try {
    const validatedData = vehicleSchema.parse(req.body);
    const result = await FleetService.createVehicle(validatedData);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetVehicles = async (req, res) => {
  try {
    const filters = req.query;
    const result = await FleetService.getVehicles(filters);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetDrivers = async (req, res) => {
  try {
    const filters = req.query;
    const result = await FleetService.getDrivers(filters);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const handleRegisterDriver = async (req, res) => {
  try {
    const validatedData = driverSchema.parse(req.body);
    // userId puede venir del body si es Admin registrando, o de req.user.id si es auto-registro
    const targetUserId = req.body.user_id || req.user.id;
    const result = await FleetService.registerDriver(targetUserId, validatedData);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.flatten().fieldErrors });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetClients = async (req, res) => {
  try {
    const clients = await FleetService.getClients();
    return res.status(200).json({ success: true, data: clients });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Cronogramas (Schedules)
 */
export const handleGetSchedules = async (req, res) => {
  try {
    const result = await FleetService.getSchedules(req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGetSchedule = async (req, res) => {
  try {
    const result = await FleetService.getSchedule(req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.code === 'PGRST116' ? 404 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export const handleCreateSchedule = async (req, res) => {
  try {
    // Note: You might want to add validation here using a new scheduleSchema
    const result = await FleetService.createSchedule(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const handleUpdateSchedule = async (req, res) => {
  try {
    const result = await FleetService.updateSchedule(req.params.id, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const handleDeleteSchedule = async (req, res) => {
  try {
    await FleetService.deleteSchedule(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleGenerateRoutes = async (req, res) => {
  try {
    const daysAhead = req.body.days_ahead || 7;
    const result = await FleetService.generateRoutesFromSchedules(daysAhead);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
