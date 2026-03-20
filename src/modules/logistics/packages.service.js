import supabase from '../../shared/config/supabase.js';

export const packagesService = {
  /**
   * Obtiene un paquete por su ID
   */
  async getById(id) {
    const { data, error } = await supabase
      .from('packages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }
};
