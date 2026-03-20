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
