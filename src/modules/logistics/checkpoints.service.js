import supabase from '../../shared/config/supabase.js';

export const checkpointsService = {
  /**
   * Obtener checkpoints de una ruta ordenados por secuencia
   */
  async getByRouteId(routeId) {
    const { data, error } = await supabase
      .from('route_checkpoints')
      .select('*')
      .eq('route_id', routeId)
      .order('sequence_order', { ascending: true });

    if (error) throw error;
    return data;
  },

  /**
   * Crear un checkpoint en una ruta
   */
  async create(routeId, checkpointData) {
    const { name, lat, lng, radius_meters = 100, sequence_order } = checkpointData;

    // Validar que las coordenadas sean válidas
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Coordenadas inválidas');
    }

    const { data, error } = await supabase
      .from('route_checkpoints')
      .insert({
        route_id: routeId,
        name,
        lat,
        lng,
        radius_meters,
        sequence_order,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Actualizar checkpoint existente
   */
  async update(routeId, checkpointId, updates) {
    const { data, error } = await supabase
      .from('route_checkpoints')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkpointId)
      .eq('route_id', routeId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Eliminar checkpoint
   */
  async delete(routeId, checkpointId) {
    const { error } = await supabase
      .from('route_checkpoints')
      .delete()
      .eq('id', checkpointId)
      .eq('route_id', routeId);

    if (error) throw error;
    return { success: true };
  },

  /**
   * Reordenar checkpoints
   */
  async reorder(routeId, checkpointIds) {
    const updates = checkpointIds.map((id, index) => ({
      id,
      sequence_order: index + 1,
    }));

    const { error } = await supabase
      .from('route_checkpoints')
      .upsert(updates);

    if (error) throw error;
    return { success: true };
  },
};
