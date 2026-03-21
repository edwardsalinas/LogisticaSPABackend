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

export const getDrivers = async (filters = {}) => {
  let query = supabase.from('drivers').select('*');
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
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

/**
 * Obtiene todos los usuarios registrados con el rol 'client'
 */
export const getClients = async () => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;

  return data.users
    .filter(u => u.user_metadata?.role === 'client')
    .map(u => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.full_name || 
            (u.user_metadata?.first_name 
              ? `${u.user_metadata.first_name} ${u.user_metadata.last_name || ''}`.trim()
              : u.email),
      phone: u.user_metadata?.phone || null
    }));
};
