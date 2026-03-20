import express from 'express';
import cors from 'cors';
import logisticsRoutes from './modules/logistics/logistics.routes.js';
import fleetRoutes from './modules/fleet/fleet.routes.js';
import trackingRoutes from './modules/tracking/tracking.routes.js';
import iamRoutes from './modules/iam/iam.routes.js';
import { setupSwagger } from './shared/config/swagger.js';
import aiAgentRoutes from './modules/ai-agent/ai-agent.routes.js';
import checkpointsRoutes from './modules/logistics/checkpoints.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

// Documentación
setupSwagger(app);

app.use('/api/logistics', logisticsRoutes);
app.use('/api/logistics', checkpointsRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/iam', iamRoutes);
app.use('/api/ai-agent', aiAgentRoutes);

export default app;
