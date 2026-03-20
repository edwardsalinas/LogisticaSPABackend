import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';
import { PACKAGE_STATUS, ROUTE_STATUS } from './logistics.schema.js';

/**
 * Obtiene todos los paquetes
 */
export const getPackages = async () => {
  const { data, error } = await supabase
    .from('packages')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * Obtiene todas las rutas de transporte
 */
export const getRoutes = async () => {
  const { data, error } = await supabase
    .from('transport_routes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * Registra un nuevo paquete
 */
export const createPackage = async (data, userId) => {
  const { origen, destino, peso, description } = data;

  const { data: inserted, error } = await supabase
    .from('packages')
    .insert([
      {
        sender_id: userId,
        origen,
        destino,
        peso,
        description,
        status: PACKAGE_STATUS.PENDING,
        tracking_code: `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return inserted;
};

/**
 * Crea una nueva ruta de transporte
 */
export const createRoute = async (data) => {
  const { data: inserted, error } = await supabase
    .from('transport_routes')
    .insert([
      {
        ...data,
        status: ROUTE_STATUS.PLANNED
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return inserted;
};

/**
 * Asigna un paquete a una ruta
 */
export const assignPackageToRoute = async (packageId, routeId) => {
  const { data: updated, error } = await supabase
    .from('packages')
    .update({
      route_id: routeId,
      status: PACKAGE_STATUS.ASSIGNED
    })
    .eq('id', packageId)
    .select()
    .single();

  if (error) throw error;
  return updated;
};

/**
 * Automatización: Escuchar entrega de paquetes
 */
eventBus.subscribe('tracking:package_delivered', async ({ packageId }) => {
  console.log(`[Logistics Service] Paquete entregado detectado: ${packageId}`);

  try {
    const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .update({ status: PACKAGE_STATUS.DELIVERED })
      .eq('id', packageId)
      .select('route_id')
      .single();

    if (pkgError || !pkg.route_id) return;

    const { data: remaining, error: checkError } = await supabase
      .from('packages')
      .select('id')
      .eq('route_id', pkg.route_id)
      .neq('status', PACKAGE_STATUS.DELIVERED);

    if (checkError) throw checkError;

    if (remaining.length === 0) {
      console.log(`[Logistics Service] Completando ruta ${pkg.route_id} automáticamente.`);
      await supabase
        .from('transport_routes')
        .update({ status: ROUTE_STATUS.COMPLETED })
        .eq('id', pkg.route_id);
    }
  } catch (err) {
    console.error(`[Logistics Service] Error en automatización:`, err);
  }
});

/**
 * Obtiene los detalles de una ruta y sus paquetes asignados
 */
export const getRoute = async (routeId) => {
  const { data, error } = await supabase
    .from('transport_routes')
    .select(`
      *,
      packages (*)
    `)
    .eq('id', routeId)
    .single();

  if (error) throw error;
  return data;
};
