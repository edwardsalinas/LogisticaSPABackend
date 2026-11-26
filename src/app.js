import express from 'express';
import cors from 'cors';
import logisticsRoutes from './modules/logistics/logistics.routes.js';
import fleetRoutes from './modules/fleet/fleet.routes.js';
import trackingRoutes from './modules/tracking/tracking.routes.js';
import iamRoutes from './modules/iam/iam.routes.js';
import { setupSwagger } from './shared/config/swagger.js';
import aiAgentRoutes from './modules/ai-agent/ai-agent.routes.js';
import checkpointsRoutes from './modules/logistics/checkpoints.routes.js';
import statisticsRoutes from './modules/statistics/statistics.routes.js';
import { apiLimiter } from './shared/middlewares/rateLimit.js';
import { securityHeaders } from './shared/middlewares/securityHeaders.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';

const app = express();

// Detrás de un proxy/balanceador (nginx, Railway, Render...) el rate limiting necesita saber
// cuántos proxies confiar para leer la IP real. Ej: TRUST_PROXY=1
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

app.disable('x-powered-by'); // no anunciar con qué está hecho el servidor
app.use(securityHeaders);

// CORS con lista de orígenes permitidos (necesario para enviar cookies con credenciales).
// CORS_ORIGIN admite varios valores separados por coma.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:8080')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Sin header Origin (curl, Postman, mismo origen vía proxy) se permite.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // Origen no permitido: no se agregan cabeceras CORS y el navegador bloquea la respuesta.
      return callback(null, false);
    },
    credentials: true,
  })
);
// Las fotos de documentos llegan en base64 (hasta ~5,5 MB): este analizador va ANTES del general, que limita a 100 kb
app.use('/api/ai-agent/documents/extract', express.json({ limit: '6mb' }));
app.use(express.json());

// Healthcheck (usado por Docker Compose)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Documentación
setupSwagger(app);

// Límite general de peticiones para toda la API
app.use('/api', apiLimiter);

app.use('/api/logistics', logisticsRoutes);
app.use('/api/logistics', checkpointsRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/iam', iamRoutes);
app.use('/api/ai-agent', aiAgentRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Rutas inexistentes y errores no capturados (JSON roto, cuerpo demasiado grande…): siempre JSON genérico. El manejador por defecto de
// Express devuelve una página con la TRAZA completa (rutas del servidor, versiones), útil para quien ataca.
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Ruta no encontrada.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 413) return res.status(413).json({ success: false, message: 'La solicitud es demasiado grande.' });
  if (status >= 400 && status < 500) return res.status(400).json({ success: false, message: 'Solicitud no válida.' });
  console.error('[API Error]:', err?.message ?? err);
  return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
});

export default app;
