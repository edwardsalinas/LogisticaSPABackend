import express from 'express';
import cors from 'cors';
import logisticsRoutes from './modules/logistics/logistics.routes.js';
import fleetRoutes from './modules/fleet/fleet.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/logistics', logisticsRoutes);
app.use('/api/fleet', fleetRoutes);

export default app;
