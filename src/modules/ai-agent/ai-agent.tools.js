import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import supabase from '../../shared/config/supabase.js';

/**
 * Herramientas (tools) del agente. Son de SOLO LECTURA y se construyen por petición, con el usuario
 * autenticado, para aplicar el mismo control de acceso que la API REST:
 *   - cliente: solo sus propios paquetes; no consulta rutas ni listados operativos.
 *   - conductor: paquetes y solo las rutas que tiene asignadas.
 *   - admin / operador logístico: acceso operativo completo.
 */
const MAX_LOGS = 15;
const MAX_ROUTES = 10;
const OPERATIONS_ROLES = ['admin', 'logistics_operator'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const canAccessPackage = (user, pkg) => user.role !== 'client' || pkg.sender_id === user.id;

export const canAccessRoute = (user, route) =>
  OPERATIONS_ROLES.includes(user.role) || (user.role === 'driver' && route.driver_id === user.id);

const DENIED = 'No tienes permiso para consultar esa información.';
const asText = (value) => JSON.stringify(value);

export const buildTools = (user, db = supabase) => {
  const getPackageTracking = tool(
    async ({ code }) => {
      try {
        if (typeof code !== 'string' || code.trim().length < 3 || code.length > 64) return 'Indica un código de rastreo válido (empieza con TRK-).';
        const query = db
          .from('packages')
          .select('id, tracking_code, status, origen, destino, peso, route_id, sender_id, created_at, delivered_at');
        const { data: pkg, error } = await (UUID_RE.test(code) ? query.eq('id', code) : query.eq('tracking_code', code.trim())).maybeSingle();
        if (error) throw error;
        if (!pkg) return 'No se encontró ningún paquete con ese código.';
        if (!canAccessPackage(user, pkg)) return DENIED;

        const { data: logs, error: logsError } = await db
          .from('tracking_logs')
          .select('status, timestamp, lat, lng')
          .eq('package_id', pkg.id)
          .order('timestamp', { ascending: false })
          .limit(MAX_LOGS);
        if (logsError) throw logsError;

        const { sender_id, ...publicPackage } = pkg; // no se expone el identificador del remitente
        return asText({ package: publicPackage, recent_tracking: logs || [] });
      } catch (e) {
        return `No se pudo consultar el paquete: ${e.message}`;
      }
    },
    {
      name: 'get_package_tracking',
      description:
        'Consulta el estado de un paquete y sus últimos eventos de seguimiento (estado, hora y posición) a partir de su código de rastreo (ej. TRK-1712345678901-A1B2C3D4).',
      // Esquemas JSON simples (sin format/min/max): los proveedores de LLM aceptan solo un subconjunto de JSON Schema.
      // Las restricciones se validan dentro de la herramienta.
      schema: z.object({
        code: z.string().describe('Código de rastreo del paquete (empieza con TRK-)'),
      }),
    }
  );

  const getRouteInfo = tool(
    async ({ routeCode, routeId }) => {
      try {
        if (!routeCode && !routeId) return 'Indica el código o el identificador de la ruta.';
        if (routeId && !UUID_RE.test(routeId)) return 'El identificador de la ruta no es válido.';
        if (routeCode && routeCode.length > 64) return 'El código de la ruta no es válido.';
        const query = db
          .from('transport_routes')
          .select('id, route_code, origin, destination, status, departure_time, driver_id, driver:drivers(full_name), packages(tracking_code, status)');
        const { data: route, error } = await (routeId ? query.eq('id', routeId) : query.eq('route_code', routeCode.trim())).maybeSingle();
        if (error) throw error;
        if (!route) return 'No se encontró esa ruta.';
        if (!canAccessRoute(user, route)) return DENIED;

        const { driver_id, ...publicRoute } = route;
        return asText(publicRoute);
      } catch (e) {
        return `No se pudo consultar la ruta: ${e.message}`;
      }
    },
    {
      name: 'get_route_info',
      description:
        'Obtiene los datos de una ruta de transporte (origen, destino, estado, salida, conductor) y los paquetes asignados, por su código de ruta o su identificador.',
      schema: z.object({
        routeCode: z.string().optional().describe('Código de la ruta (route_code)'),
        routeId: z.string().optional().describe('Identificador UUID de la ruta'),
      }),
    }
  );

  const listRoutes = tool(
    async ({ status }) => {
      try {
        if (!OPERATIONS_ROLES.includes(user.role)) return DENIED;
        let query = db
          .from('transport_routes')
          .select('route_code, origin, destination, status, departure_time')
          .order('departure_time', { ascending: false })
          .limit(MAX_ROUTES);
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) throw error;
        return asText(data || []);
      } catch (e) {
        return `No se pudo listar las rutas: ${e.message}`;
      }
    },
    {
      name: 'list_routes',
      description: `Lista las ${MAX_ROUTES} rutas más recientes, opcionalmente filtradas por estado. Solo para administradores y operadores logísticos.`,
      schema: z.object({
        status: z.enum(['planeada', 'en_transito', 'completada']).optional().describe('Estado de la ruta'),
      }),
    }
  );

  return [getPackageTracking, getRouteInfo, listRoutes];
};
