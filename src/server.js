import http from 'http';
import app from './app.js';
import { initScheduler } from './shared/utils/scheduler.js';
import { installProcessGuards } from './shared/utils/processGuards.js';

// Un error de un proveedor de IA que nadie captura no debe tumbar el servidor (ver processGuards.js)
installProcessGuards();

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[Core] Server running on port ${PORT}`);
  
  // Iniciar tareas programadas
  initScheduler();
});
