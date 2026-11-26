/**
 * Cabeceras de seguridad para toda la API (sin dependencias nuevas). La API solo devuelve JSON, así que se cierran las puertas que un
 * navegador podría abrir:
 *  - nosniff: no «adivinar» el tipo de una respuesta;
 *  - X-Frame-Options y frame-ancestors: la API nunca se muestra dentro de un marco (clickjacking);
 *  - Referrer-Policy: no filtra la dirección de la página a otros sitios;
 *  - Permissions-Policy: el micrófono y la ubicación solo para la propia aplicación;
 *  - Cache-Control: no-store: las respuestas con datos de la persona no se guardan en cachés compartidas ni en el historial;
 *  - Strict-Transport-Security: solo bajo https (en http local no tiene sentido).
 * La política de contenido de la página (CSP) corresponde al servidor que entrega el frontend (ver nginx.conf del frontend).
 */
export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=(self), camera=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
};
