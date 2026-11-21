import * as TrackingService from '../tracking/tracking.service.js';
import * as LogisticsService from '../logistics/logistics.service.js';

/**
 * Qué hace cada acción al confirmarse. Reutiliza los MISMOS servicios que la API REST y la interfaz clásica,
 * así que se aplican las mismas reglas (estados finales, un conductor solo entrega paquetes de sus rutas,
 * responsable registrado en el historial, etc.). `user` es siempre el usuario autenticado que confirmó.
 */
const STATUS_LABELS = { en_transito: 'En tránsito', en_agencia: 'En agencia', siniestro: 'Siniestro' };

export const defaultExecutors = {
  async register_tracking_event(p, user) {
    const event = await TrackingService.logEvent(
      { package_id: p.package_id, lat: p.lat, lng: p.lng, status: p.status, observations: p.observations },
      user
    );
    return { message: `Evento "${STATUS_LABELS[p.status] ?? p.status}" registrado para ${p.tracking_code}.`, data: { tracking_code: p.tracking_code, event_id: event?.id } };
  },

  async deliver_package(p, user) {
    await LogisticsService.deliverPackage(p.package_id, { user, note: p.note });
    return { message: `Paquete ${p.tracking_code} marcado como entregado.`, data: { tracking_code: p.tracking_code } };
  },

  async create_package(p, user) {
    const created = await LogisticsService.createPackage(p.data, user.id);
    return { message: `Paquete creado con el código ${created.tracking_code}.`, data: { tracking_code: created.tracking_code } };
  },
};
