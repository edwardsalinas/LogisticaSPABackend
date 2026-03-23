import http from 'http';
import app from './app.js';
import { initScheduler } from './shared/utils/scheduler.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[Core] Server running on port ${PORT}`);
  
  // Iniciar tareas programadas
  initScheduler();
});
