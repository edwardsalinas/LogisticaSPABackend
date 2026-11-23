/**
 * Protección contra rechazos de promesas que nadie captura.
 *
 * Las librerías de los proveedores de IA (p. ej. @google/generative-ai) pueden rechazar una promesa interna cuando
 * falla el análisis de una respuesta en streaming ("Failed to parse stream"); esa promesa no está al alcance del código
 * del agente, y desde Node 15 un rechazo sin capturar termina el proceso: un solo mensaje fallido tumbaba todo el servidor.
 *
 * Los errores de proveedores de IA solo se registran (la petición que los causó ya recibe su propio error y el balanceador
 * prueba otro modelo). Cualquier otro rechazo sin capturar sigue siendo un fallo inesperado: se registra y se termina el proceso.
 */
const PROVIDER_ERROR = /GoogleGenerativeAI|generativelanguage\.googleapis|\[LLM\]|Failed to parse stream/i;

export function isProviderError(reason) {
  const text = `${reason?.name || ''} ${reason?.message || ''} ${typeof reason === 'string' ? reason : ''}`;
  return PROVIDER_ERROR.test(text);
}

export function installProcessGuards(proc = process, log = console) {
  proc.on('unhandledRejection', (reason) => {
    if (isProviderError(reason)) {
      log.error('[LLM] Error de un proveedor de IA sin capturar; se registra y el servidor sigue:', reason?.message || reason);
      return;
    }
    log.error('[Core] Rechazo de promesa sin capturar; se termina el proceso:', reason);
    proc.exit(1);
  });
}
