import supabase from '../../shared/config/supabase.js';
import { VEHICLE_STATUS } from './fleet.schema.js';

/**
 * Gestión de Vehículos
 */
export const createVehicle = async (data) => {
  const { data: inserted, error } = await supabase
    .from('vehicles')
    .insert([data])
    .select()
    .single();

  if (error) throw error;
  return inserted;
};

export const getVehicles = async (filters = {}) => {
  let query = supabase.from('vehicles').select('*');

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

/**
 * Obtiene todos los choferes
 */
export const getDrivers = async () => {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * Gestión de Choferes (Perfiles)
 */
export const registerDriver = async (userId, data) => {
  const { data: inserted, error } = await supabase
    .from('drivers')
    .insert([{
      id: userId, // Relación 1:1 con Auth User
      ...data
    }])
    .select()
    .single();

  if (error) throw error;
  return inserted;
};

/**
 * Interfaz Pública del Módulo (Consultada por otros módulos)
 */
export const getActiveDriver = async (driverId) => {
  const { data, error } = await supabase
    .from('drivers')
    .select('*, vehicles(*)')
    .eq('id', driverId)
    .single();

  if (error) throw error;
  return data;
};
