import { randomUUID } from 'node:crypto';
import { clearToolCache } from './ai-agent.cache.js';

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
  assign_package: OPS,
  cancel_package: OPS,
  assign_driver: OPS,
  create_trip: OPS,
  reschedule_trip: OPS,
  cancel_trip: OPS,
  create_vehicle: ['admin'],
  update_vehicle: ['admin'],
  delete_vehicle: ['admin'],
  update_package: OPS,
  plan: OPS,
};

const store = new Map();

const httpError = (status, message) => Object.assign(new Error(message), { status });

const purgeExpired = (now = Date.now()) => {
  for (const [id, p] of store) if (p.expiresAt <= now) store.delete(id);
};

/**
 * Datos que se envían al navegador: nunca los parámetros internos ni el dueño.
 * `ui` (opcional) son los mismos datos que ya muestra el resumen, en forma estructurada, para que la pantalla pueda
 * mostrar cómo se hace la acción (Logi llena el formulario). No sustituye a la confirmación: quien ejecuta es el servidor.
 */
const toPublic = (p) => ({
  id: p.id, type: p.type, title: p.title, lines: p.lines, expires_at: new Date(p.expiresAt).toISOString(),
  ...(p.ui ? { ui: p.ui } : {}),
});

export const createProposal = ({ user, type, params, title, lines, ui }, now = Date.now()) => {
  if (!ACTION_ROLES[type]) throw httpError(400, 'Acción desconocida');
  if (!ACTION_ROLES[type].includes(user.role)) throw httpError(403, 'No tienes permiso para esta acción');
  purgeExpired(now);

  // un usuario no acumula propuestas: al pasar el límite se descartan las más antiguas
  const mine = [...store.values()].filter((p) => p.userId === user.id && p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length >= MAX_PENDING_PER_USER) store.delete(mine.shift().id);

  const proposal = { id: randomUUID(), userId: user.id, type, params, title, lines, ui, status: 'pending', createdAt: now, expiresAt: now + ACTION_TTL_MS };
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
    clearToolCache(); // los resúmenes en caché ya no reflejan lo que acaba de cambiar
    console.info(`[AI Action] ${p.type} confirmada por ${user.id} (${user.role})`);
    // si la acción se puede devolver, el servidor guarda cómo estaba y da al navegador solo un identificador
    const undo = result.undo ? registerUndo(user, result.undo, now) : null;
    const data = result.data ?? null;
    const extra = { ...(undo ? { undo } : {}), ...(result.reveal ? { reveal: result.reveal } : {}) };
    return { message: result.message, data: Object.keys(extra).length ? { ...(data ?? {}), ...extra } : data };
  } catch (error) {
    p.status = 'failed';
    throw error;
  }
};

// ---- «Deshacer» del servidor: lo que se hizo se puede devolver, una sola vez, por quien lo hizo y por un rato.
// El navegador NUNCA manda qué deshacer ni con qué datos: solo el identificador que el servidor le dio al confirmar.
export const UNDO_TTL_MS = 30 * 60 * 1000;
const undoStore = new Map();

export const registerUndo = (user, { type, label, params }, now = Date.now()) => {
  for (const [id, u] of undoStore) if (u.expiresAt <= now) undoStore.delete(id);
  const id = randomUUID();
  undoStore.set(id, { userId: user.id, type, label, params, used: false, expiresAt: now + UNDO_TTL_MS });
  return { id, label, expires_at: new Date(now + UNDO_TTL_MS).toISOString() };
};

/** Devuelve lo que se hizo con la acción `id` (la del registro). `undoExecutors` se inyecta para poder probar sin base de datos. */
export const runUndo = async (id, user, undoExecutors, now = Date.now()) => {
  const u = undoStore.get(id);
  if (!u || u.userId !== user.id) throw httpError(404, 'No hay nada que deshacer (o ya pasó mucho tiempo).');
  if (u.expiresAt <= now) { undoStore.delete(id); throw httpError(410, 'Ya pasó el tiempo para deshacer esto (30 minutos).'); }
  if (u.used) throw httpError(409, 'Esto ya se deshizo.');
  if (!ACTION_ROLES[u.type]?.includes(user.role)) throw httpError(403, 'No tienes permiso para esta acción');
  u.used = true; // un solo uso, también si la segunda llamada llega mientras corre la primera
  try {
    const result = await undoExecutors[u.type](u.params);
    clearToolCache();
    console.info(`[AI Action] deshacer ${u.type} por ${user.id} (${user.role})`);
    return { message: result.message };
  } catch (error) {
    u.used = false; // no se pudo: se puede volver a intentar (si el estado cambió, volverá a fallar con su motivo)
    throw error;
  }
};

/** Solo para pruebas. */
export const _resetUndo = () => undoStore.clear();

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
