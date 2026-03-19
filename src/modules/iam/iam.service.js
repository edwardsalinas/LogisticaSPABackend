import supabase from '../../shared/config/supabase.js';

/**
 * Servicio encargado de la comunicación directa con Supabase Auth.
 * Encapsula la lógica de identidad para que otros módulos no dependan
 * directamente del cliente de Supabase para temas de autenticación.
 */
export const verifyToken = async (token) => {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return user;
};

// Futuras funciones de IAM:
// export const signIn = async (email, password) => { ... }
// export const signUp = async (email, password, metadata) => { ... }
