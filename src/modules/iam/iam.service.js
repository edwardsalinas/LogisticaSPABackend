import supabase from '../../shared/config/supabase.js';

/**
 * Servicio encargado de la comunicación directa con Supabase Auth.
 * Encapsula la lógica de identidad para que otros módulos no dependan
 * directamente del cliente de Supabase para temas de autenticación.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ¿El fallo es del SERVICIO (sin red, proveedor caído o saturado) y no de la sesión? Un token vencido o inválido es un 401 de verdad; un
 * corte momentáneo hacia Supabase NO debe parecerlo, porque el navegador respondería «sesión vencida» y la cerraría sin motivo.
 */
export const isTransientAuthError = (error) => {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError') return true;
  const status = error.status;
  if (typeof status === 'number') return status === 0 || status === 429 || status >= 500;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|socket/i.test(`${error.message ?? ''} ${error.cause?.code ?? ''} ${error.code ?? ''}`);
};

/**
 * Valida el token con Supabase. Ante un fallo del servicio reintenta una vez (los cortes suelen durar un instante); si sigue fallando
 * lanza el error original, que el middleware distingue con isTransientAuthError. `client` se inyecta para poder probarlo sin red.
 */
export const verifyToken = async (token, { client = supabase, retries = 1, waitMs = 250 } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    const { data, error } = await client.auth.getUser(token).catch((e) => ({ data: {}, error: e }));
    if (!error) return data.user;
    if (!isTransientAuthError(error) || attempt >= retries) throw error;
    await sleep(waitMs);
  }
};

// Futuras funciones de IAM:
// export const signIn = async (email, password) => { ... }
// export const signUp = async (email, password, metadata) => { ... }

/**
 * Renovar la sesión. Devuelve { data } si salió bien, { error } si el refresh token ya no vale (sesión vencida: hay que cerrarla) o
 * { transient: true, error } si fue un corte del servicio (NO se debe cerrar la sesión: el refresh token sigue siendo bueno).
 */
export const refreshWith = async (authClient, refreshToken) => {
  try {
    const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error) return { transient: isTransientAuthError(error), error };
    if (!data?.session) return { error: { message: 'Sesión expirada' } };
    return { data };
  } catch (error) {
    return { transient: isTransientAuthError(error), error };
  }
};

/** Iniciar sesión con correo y contraseña; distingue credenciales inválidas (error) de un corte del servicio (transient). */
export const signInWith = async (authClient, credentials) => {
  try {
    const { data, error } = await authClient.auth.signInWithPassword(credentials);
    if (error) return { transient: isTransientAuthError(error), error };
    return { data };
  } catch (error) {
    return { transient: isTransientAuthError(error), error };
  }
};
