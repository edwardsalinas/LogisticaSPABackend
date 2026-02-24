import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// --- Modular Monolith Architecture ---
// Importing Modules
import logisticsRoutes from './modules/logistics/routes.js';
import agentRoutes from './modules/agent/routes.js';

// Mounting Modules (Routes)
app.use('/api/logistics', logisticsRoutes);
app.use('/api/agent', agentRoutes);

// Root Endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        system: 'Logistics AI Platform (POC)',
        architecture: 'Modular Monolith'
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Modular Monolith: Logistics & Agent modules loaded.`);
});
