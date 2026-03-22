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
 * Lista todos los conductores (con filtros opcionales)
 */
export const getDrivers = async (filters = {}) => {
  let query = supabase.from('drivers').select('*').order('created_at', { ascending: false });
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

/**
 * Gestión de Cronogramas (Schedules)
 */
export const getSchedules = async (filters = {}) => {
  let query = supabase.from('schedules').select('*, predefined_routes(*), drivers(*), vehicles(*)');
  if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const getSchedule = async (id) => {
  const { data, error } = await supabase
    .from('schedules')
    .select('*, predefined_routes(*), drivers(*), vehicles(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
};

export const createSchedule = async (data) => {
  const { data: inserted, error } = await supabase
    .from('schedules')
    .insert([data])
    .select()
    .single();
  if (error) throw error;
  return inserted;
};

export const updateSchedule = async (id, data) => {
  const { data: updated, error } = await supabase
    .from('schedules')
    .update(data)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return updated;
};

export const deleteSchedule = async (id) => {
  const { error } = await supabase.from('schedules').delete().eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * Generación de Rutas desde Cronogramas
 */
export const generateRoutesFromSchedules = async (daysAhead = 7) => {
  // 1. Obtener cronogramas activos
  const { data: activeSchedules, error: sError } = await supabase
    .from('schedules')
    .select('*, predefined_routes(*)')
    .eq('is_active', true);

  if (sError) throw sError;

  const generated = [];
  const errors = [];

  // 2. Proyectar fechas
  const today = new Date();
  for (let i = 0; i <= daysAhead; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + i);
    const dayOfWeek = targetDate.getDay(); // 0-6
    const dateStr = targetDate.toISOString().split('T')[0];

    // 3. Filtrar cronogramas que tengan este día de la semana configurado
    const daySchedules = activeSchedules.filter(s => s.day_times && s.day_times[String(dayOfWeek)]);

    for (const schedule of daySchedules) {
      try {
        // Obtener la hora específica para este día del objeto JSONB
        const dayTime = schedule.day_times[String(dayOfWeek)];
        const departureTime = `${dateStr}T${dayTime}`;

        // Determinar origen y destino (predefinido o manual)
        const origin = schedule.predefined_route_id ? schedule.predefined_routes?.origin_city : schedule.origin;
        const destination = schedule.predefined_route_id ? schedule.predefined_routes?.destination_city : schedule.destination;
        const origin_lat = schedule.predefined_route_id ? schedule.predefined_routes?.origin_lat : schedule.origin_lat;
        const origin_lng = schedule.predefined_route_id ? schedule.predefined_routes?.origin_lng : schedule.origin_lng;
        const dest_lat = schedule.predefined_route_id ? schedule.predefined_routes?.dest_lat : schedule.dest_lat;
        const dest_lng = schedule.predefined_route_id ? schedule.predefined_routes?.dest_lng : schedule.dest_lng;

        // Insertar en transport_routes
        const { data: newRoute, error: rError } = await supabase
          .from('transport_routes')
          .insert([{
            origin,
            destination,
            origin_lat,
            origin_lng,
            dest_lat,
            dest_lng,
            departure_time: departureTime,
            driver_id: schedule.driver_id,
            vehicle_id: schedule.vehicle_id,
            status: 'planeada',
            schedule_id: schedule.id,
            scheduled_date: dateStr
          }])
          .select()
          .single();

        if (rError) {
          if (rError.code === '23505') {
             // Ya existe para esta fecha/cronograma, ignorar
             continue;
          }
          throw rError;
        }

        generated.push(newRoute);
      } catch (err) {
        errors.push({ scheduleId: schedule.id, date: dateStr, error: err.message });
      }
    }
  }

  return { generatedCount: generated.length, errors };
};
