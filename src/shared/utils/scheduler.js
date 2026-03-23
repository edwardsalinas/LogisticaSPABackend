import * as FleetService from '../../modules/fleet/fleet.service.js';

/**
 * Sistema de Tareas Programadas (Simple Scheduler)
 * Evita dependencias externas como node-cron para simplificar el despliegue.
 */
export const initScheduler = () => {
    console.log('[Scheduler] Iniciando sistema de tareas automáticas...');

    // 1. Ejecución inmediata al arrancar (asegura que siempre haya datos al iniciar el servidor)
    runDailyProjections();

    // 2. Programar ejecución cada 24 horas (en milisegundos)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(runDailyProjections, TWENTY_FOUR_HOURS);
};

const runDailyProjections = async () => {
    try {
        console.log('[Scheduler] Ejecutando proyección automática de rutas (30 días)...');
        const result = await FleetService.generateRoutesFromSchedules(30);
        console.log(`[Scheduler] Proyección completada con éxito. Rutas generadas: ${result.generatedCount}`);
        if (result.errors && result.errors.length > 0) {
            console.warn(`[Scheduler] Se encontraron ${result.errors.length} errores durante la proyección.`);
        }
    } catch (err) {
        console.error('[Scheduler] Error crítico en la tarea de proyección:', err);
    }
};
