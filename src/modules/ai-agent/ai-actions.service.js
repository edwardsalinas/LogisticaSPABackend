import { randomUUID } from 'node:crypto';

/**
 * Acciones del asistente CON CONFIRMACIÓN.
 *
 * El modelo de lenguaje nunca modifica datos: sus herramientas `propose_*` solo crean una PROPUESTA aquí
 * (con el resumen redactado por el servidor a partir de datos ya validados). La acción se ejecuta únicamente
 * cuando el usuario pulsa "Confirmar" en la interfaz, que llama a POST /api/ai-agent/actions/:id/confirm con
 * su propia sesión. Por eso una instrucción maliciosa escondida en un dato (inyección de prompt) no puede
 * ejecutar nada por sí sola.
 *
 * Garantías: la propuesta pertenece a un usuario (otro no puede confirmarla), es de un solo uso, caduca, y
 * al confirmar se vuelve a comprobar el rol y se aplican las mismas reglas de los servicios de siempre.
 * Las propuestas viven en memoria del proceso: si el servidor se reinicia se pierden (el usuario las pide de nuevo).
 */
export const ACTION_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_PER_USER = 5;

const OPS = ['admin', 'logistics_operator'];
export const ACTION_ROLES = {
  register_tracking_event: OPS,
  deliver_package: [...OPS, 'driver'],
  create_package: OPS,
};

const store = new Map();

const httpError = (status, message) => Object.assign(new Error(message), { status });

const purgeExpired = (now = Date.now()) => {
  for (const [id, p] of store) if (p.expiresAt <= now) store.delete(id);
};

/** Datos que se envían al navegador: nunca los parámetros internos ni el dueño. */
const toPublic = (p) => ({ id: p.id, type: p.type, title: p.title, lines: p.lines, expires_at: new Date(p.expiresAt).toISOString() });

export const createProposal = ({ user, type, params, title, lines }, now = Date.now()) => {
  if (!ACTION_ROLES[type]) throw httpError(400, 'Acción desconocida');
  if (!ACTION_ROLES[type].includes(user.role)) throw httpError(403, 'No tienes permiso para esta acción');
  purgeExpired(now);

  // un usuario no acumula propuestas: al pasar el límite se descartan las más antiguas
  const mine = [...store.values()].filter((p) => p.userId === user.id && p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length >= MAX_PENDING_PER_USER) store.delete(mine.shift().id);

  const proposal = { id: randomUUID(), userId: user.id, type, params, title, lines, status: 'pending', createdAt: now, expiresAt: now + ACTION_TTL_MS };
  store.set(proposal.id, proposal);
  return toPublic(proposal);
};

// Una propuesta ajena se trata como inexistente (no se revela que exista)
const own = (id, user) => {
  const p = store.get(id);
  return p && p.userId === user.id ? p : null;
};

/**
 * Ejecuta la propuesta confirmada. `executors` se inyecta para poder probar sin base de datos.
 */
export const confirmProposal = async (id, user, executors, now = Date.now()) => {
  const p = own(id, user);
  if (!p) throw httpError(404, 'La acción no existe o ya no está disponible');
  if (p.expiresAt <= now) {
    store.delete(id);
    throw httpError(410, 'La acción venció. Pídesela de nuevo al asistente.');
  }
  if (p.status !== 'pending') throw httpError(409, p.status === 'done' ? 'Esta acción ya se ejecutó' : 'Esta acción ya no se puede confirmar');
  if (!ACTION_ROLES[p.type]?.includes(user.role)) throw httpError(403, 'No tienes permiso para esta acción');

  p.status = 'running'; // bloqueo: una segunda confirmación simultánea recibe 409
  try {
    const result = await executors[p.type](p.params, user);
    p.status = 'done';
    console.info(`[AI Action] ${p.type} confirmada por ${user.id} (${user.role})`);
    return { message: result.message, data: result.data ?? null };
  } catch (error) {
    p.status = 'failed';
    throw error;
  }
};

export const cancelProposal = (id, user) => {
  const p = own(id, user);
  if (!p) throw httpError(404, 'La acción no existe o ya no está disponible');
  if (p.status !== 'pending') throw httpError(409, 'Esta acción ya no se puede cancelar');
  p.status = 'cancelled';
  return { message: 'Acción cancelada. No se hizo ningún cambio.' };
};

/** Solo para pruebas. */
export const _resetProposals = () => store.clear();
export const _countProposals = () => store.size;
