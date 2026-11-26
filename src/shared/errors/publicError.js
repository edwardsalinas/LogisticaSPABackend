/**
 * Qué se le cuenta al cliente cuando algo falla. Los errores con un `status` 4xx los lanza el propio código para el usuario
 * («No se encontró el paquete», «El viaje ya salió»…) y se muestran tal cual. Todo lo demás (un error de la base de datos o de una
 * librería) NO se muestra: su mensaje revela nombres de tablas, columnas y restricciones, que ayudan a quien quiere atacar el sistema.
 * Los errores de datos más comunes de Postgres se traducen a un mensaje útil y sin detalles internos; el resto es un 500 genérico y el
 * detalle real queda solo en el registro del servidor.
 */
const PG_USER_ERRORS = {
  '23505': { status: 409, message: 'Ya existe un registro con esos datos.' },
  '23503': { status: 409, message: 'El dato hace referencia a un registro que no existe o que está en uso.' },
  '23502': { status: 400, message: 'Falta un dato obligatorio.' },
  '23514': { status: 400, message: 'Los datos enviados no son válidos.' },
  '22P02': { status: 400, message: 'Los datos enviados no tienen el formato correcto.' },
  '22001': { status: 400, message: 'Uno de los datos es demasiado largo.' },
};

export const publicError = (error, fallbackStatus = 500) => {
  const explicit = Number(error?.status ?? error?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 400 && explicit < 500) return { status: explicit, message: String(error.message || 'Solicitud no válida.') };
  // «No disponible» (503) es un mensaje deliberado nuestro, no un fallo: solo se muestra si quien lo lanzó lo marcó `expose` (un 5xx accidental sigue siendo genérico).
  if (explicit === 503 && error.expose === true) return { status: 503, message: String(error.message) };
  const pg = PG_USER_ERRORS[String(error?.code ?? '')];
  if (pg) return pg;
  console.error('[API Error]:', error?.message ?? error);
  return { status: fallbackStatus >= 500 ? fallbackStatus : 500, message: 'Error interno del servidor.' };
};
