import { createClient } from '@supabase/supabase-js';
import env from './env.js';

// Cliente con Service Role para bypass de RLS (Uso en Servicios)
export const serviceSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// Cliente por defecto (Mantenemos el export default para no romper compatibilidad)
const supabase = serviceSupabase;
export default supabase;
