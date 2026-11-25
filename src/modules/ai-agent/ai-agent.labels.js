/**
 * Nombres legibles para el asistente. A las personas no se les habla de «el viaje 275100fc-…»: se les dice «el viaje de Santa Cruz
 * a Cochabamba de hoy a las 19:00». El servidor arma esa frase (con la hora de Bolivia) para que el modelo la repita tal cual en
 * vez de improvisarla o, peor, mostrar un identificador interno.
 */
const HOUR_MS = 60 * 60 * 1000;
const TZ = 'America/La_Paz';

export const timeLabel = (iso) => new Date(iso).toLocaleTimeString('es-BO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export const dayLabel = (iso, now = Date.now()) => {
  const fmt = (t) => new Date(t).toLocaleDateString('es-BO', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (fmt(iso) === fmt(now)) return 'hoy';
  if (fmt(iso) === fmt(now + 24 * HOUR_MS)) return 'mañana';
  if (fmt(iso) === fmt(now - 24 * HOUR_MS)) return 'ayer';
  const near = Math.abs(Date.parse(iso) - now) < 6 * 24 * HOUR_MS;
  return new Date(iso).toLocaleDateString('es-BO', near ? { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' } : { timeZone: TZ, day: 'numeric', month: 'long' });
};

/** «el viaje de Santa Cruz a Cochabamba de hoy a las 19:00» (sin identificadores internos). */
export const tripLabel = ({ origin, destination, departure_time: departure } = {}, now = Date.now()) => {
  const route = origin && destination ? `el viaje de ${origin} a ${destination}` : 'el viaje';
  if (!departure || Number.isNaN(Date.parse(departure))) return route;
  const day = dayLabel(departure, now);
  return `${route} ${day === 'hoy' || day === 'mañana' || day === 'ayer' ? `de ${day}` : `del ${day}`} a las ${timeLabel(departure)}`;
};
