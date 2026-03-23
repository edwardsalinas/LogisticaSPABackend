import * as TripsService from './trips.service.js';

export const handleStartTrip = async (req, res) => {
  try {
    const driverId = req.user.id;
    const { route_id } = req.body;
    const result = await TripsService.startTrip(driverId, route_id);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.message.includes('Ya existe') ? 409 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export const handleStopTrip = async (req, res) => {
  try {
    const driverId = req.user.id;
    const result = await TripsService.stopTrip(driverId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.message.includes('No hay un viaje activo') ? 400 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export const handleGetActiveTrip = async (req, res) => {
  try {
    const driverId = req.user.id;
    const result = await TripsService.getActiveTrip(driverId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
