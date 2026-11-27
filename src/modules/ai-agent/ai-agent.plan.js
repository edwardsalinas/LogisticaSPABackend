import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { cancelProposal, confirmProposal, createProposal } from './ai-actions.service.js';
import { proposalResult } from './ai-proposal-result.js';
import { checkRouteForPackage, prepareAssignProposal, prepareCreateProposal, prepareEventProposal } from './ai-agent.actions.js';
import { prepareDriverProposal, prepareTripProposal } from './ai-agent.fleet-actions.js';
import { prepareCreateVehicleProposal, prepareRescheduleProposal } from './ai-agent.manage-actions.js';

/**
 * Plan de varios pasos con UNA sola confirmación: «crea el paquete, asígnalo al viaje de mañana y muéstramelo».
 *
 * Cómo se mantiene seguro:
 *  - Solo pasos que ya existen como acción con confirmación, y NO los irreversibles (cancelar, anular, entregar, retirar un vehículo):
 *    esos siguen pidiendo su propia confirmación.
 *  - Al PROPONER, cada paso se valida con la misma preparación de siempre (permisos, estado, espacio) y se descarta: el plan solo guarda
 *    los pasos, no resultados a medias. Un paso que se apoya en otro ($1 = el paquete que crea el paso 1) se valida hasta donde se puede.
 *  - Al CONFIRMAR, cada paso se vuelve a preparar y a confirmar en orden con las mismas reglas del usuario, así «asignar» ya ve el paquete
 *    creado. Si un paso falla, el plan SE DETIENE y dice qué quedó hecho: no hay marcha atrás automática.
 */
const OPS = ['admin', 'logistics_operator'];
export const MAX_PLAN_STEPS = 4;

const asJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
const REF = /^\$(\d)$/;

// acción → cómo se prepara. `refs`: argumentos que pueden apoyarse en un paso anterior.
export const PLAN_ACTIONS = {
  create_package: { prepare: prepareCreateProposal, label: 'Registrar un paquete' },
  assign_package: { prepare: prepareAssignProposal, label: 'Asignar a un viaje', canRef: true },
  register_event: { prepare: prepareEventProposal, label: 'Registrar un evento', canRef: true },
  assign_driver: { prepare: prepareDriverProposal, label: 'Asignar conductor' },
  create_trip: { prepare: prepareTripProposal, label: 'Crear un viaje' },
  reschedule_trip: { prepare: prepareRescheduleProposal, label: 'Reprogramar un viaje' },
  create_vehicle: { prepare: prepareCreateVehicleProposal, label: 'Registrar un vehículo' },
};
export const PLAN_ACTION_NAMES = Object.keys(PLAN_ACTIONS);

/** ¿A qué paso anterior se refiere este paso? ($1 en code o codes). Devuelve el número (1…) o null. */
const refOf = (args = {}) => {
  const values = [args.code, ...(Array.isArray(args.codes) ? args.codes : [])];
  const hit = values.map((v) => REF.exec(String(v ?? ''))).find(Boolean);
  return hit ? Number(hit[1]) : null;
};

/** Cambia $n por el código real del paquete que creó el paso n. */
const resolveArgs = (args, made) => {
  const swap = (v) => { const m = REF.exec(String(v ?? '')); return m ? made[Number(m[1])] ?? v : v; };
  return { ...args, ...(args.code ? { code: swap(args.code) } : {}), ...(Array.isArray(args.codes) ? { codes: args.codes.map(swap) } : {}) };
};

const stepSummary = (n, step, prepared) => `${n}. ${PLAN_ACTIONS[step.action].label}: ${(prepared.lines ?? []).slice(0, 3).join(' · ')}`;

/** Valida el plan y crea la propuesta. Devuelve el JSON de la propuesta o el motivo del rechazo. */
export const preparePlanProposal = async (user, db, { steps } = {}, now = Date.now()) => {
  try {
    if (!OPS.includes(user.role)) return 'No tienes permiso para realizar esa acción.';
    if (!Array.isArray(steps) || steps.length < 2) return 'Un plan necesita al menos dos pasos. Para una sola cosa usa su propia acción.';
    if (steps.length > MAX_PLAN_STEPS) return `Un plan puede tener hasta ${MAX_PLAN_STEPS} pasos. Divídelo en dos pedidos.`;

    const clean = [];
    const lines = [];
    for (const [i, raw] of steps.entries()) {
      const n = i + 1;
      const { action, ...args } = raw ?? {};
      const spec = PLAN_ACTIONS[action];
      if (!spec) return `El paso ${n} («${action}») no se puede incluir en un plan. Lo irreversible (anular, cancelar, entregar, retirar) se pide aparte. Acciones válidas: ${PLAN_ACTION_NAMES.join(', ')}.`;
      const ref = refOf(args);
      if (ref !== null) {
        if (!spec.canRef) return `El paso ${n} no puede apoyarse en otro paso.`;
        if (ref >= n || ref < 1 || steps[ref - 1]?.action !== 'create_package') return `El paso ${n} usa $${ref}, pero ese paso no crea un paquete anterior.`;
        // se apoya en un paquete que aún no existe: se valida lo que se puede (el viaje y su espacio) y se resume
        if (action === 'assign_package') {
          const peso = Number(steps[ref - 1].peso) || 0;
          const check = await checkRouteForPackage(db, args.route_ref, peso);
          if (check.error) return `Paso ${n}: ${check.error}`;
          lines.push(`${n}. ${spec.label}: el paquete del paso ${ref} → ${check.route.origin} → ${check.route.destination}`);
        } else {
          lines.push(`${n}. ${spec.label}: sobre el paquete del paso ${ref} (estado ${args.status ?? '—'})`);
        }
        clean.push({ action, args });
        continue;
      }
      // sin dependencias: se prepara como siempre, se toma su resumen y se descarta (el plan guarda solo el paso)
      const out = await spec.prepare(user, db, args, now);
      const parsed = asJson(out);
      if (!parsed?.action) return `Paso ${n} (${spec.label}): ${typeof out === 'string' ? out : 'no se pudo preparar.'}`;
      cancelProposal(parsed.action.id, user);
      lines.push(stepSummary(n, { action }, parsed.action));
      clean.push({ action, args });
    }

    const proposal = createProposal({
      user,
      type: 'plan',
      params: { steps: clean, items: [] },
      title: `Plan de ${clean.length} pasos`,
      lines: [...lines, 'Se hacen en orden con UNA confirmación. Si un paso falla, el plan se detiene y se avisa qué quedó hecho (no se deshace solo).'],
    }, now);
    return proposalResult(proposal);
  } catch (e) {
    return `No se pudo preparar el plan: ${e.message}`;
  }
};

/**
 * Ejecuta el plan al confirmarlo: cada paso se vuelve a preparar y a confirmar con las mismas reglas del usuario, en orden.
 * `executors` son los ejecutores de siempre (se inyectan para no depender de ellos aquí).
 */
export const applyPlan = async (p, user, db, executors) => {
  const done = [];
  const made = {}; // n → código del paquete creado por el paso n
  const results = [];
  for (const [i, step] of p.steps.entries()) {
    const n = i + 1;
    const spec = PLAN_ACTIONS[step.action];
    let failure = null;
    try {
      const out = await spec.prepare(user, db, resolveArgs(step.args, made));
      const parsed = asJson(out);
      if (!parsed?.action) failure = typeof out === 'string' ? out : 'no se pudo preparar';
      else {
        const res = await confirmProposal(parsed.action.id, user, executors);
        if (res.data?.tracking_code) { made[n] = res.data.tracking_code; results.push({ tracking_code: res.data.tracking_code, ok: true }); }
        for (const r of res.data?.results ?? []) if (r.ok && r.tracking_code && !results.some((x) => x.tracking_code === r.tracking_code)) results.push({ tracking_code: r.tracking_code, ok: true });
        done.push(`${n}. ${res.message}`);
      }
    } catch (error) {
      failure = error.message;
    }
    if (failure) {
      const hecho = done.length ? `Quedó hecho: ${done.join(' ')}` : 'No quedó nada hecho.';
      const pendientes = p.steps.length - n;
      const err = new Error(`El plan se detuvo en el paso ${n} (${spec.label}): ${failure} ${hecho}${pendientes ? ` ${pendientes === 1 ? 'Faltó 1 paso' : `Faltaron ${pendientes} pasos`}.` : ''}`);
      err.status = 409;
      throw err;
    }
  }
  return { message: `Plan completo (${done.length} pasos). ${done.join(' ')}`, data: { results } };
};

/** La herramienta del agente: propone el plan (la ejecución ocurre al confirmar). */
export const buildPlanTools = (user, db) => {
  return [tool(
    async (args) => preparePlanProposal(user, db, args),
    {
      name: 'propose_plan',
      description: `PROPONE varios pasos que dependen unos de otros con UNA sola confirmación (de 2 a 4), p. ej. "crea el paquete y asígnalo al viaje de mañana". Cada paso es una acción: ${PLAN_ACTION_NAMES.join(', ')}. Si un paso se apoya en el paquete que crea un paso anterior, pon en su code o codes el texto "$1" (el número del paso que lo crea). NO uses un plan para cosas sueltas ni para lo irreversible (anular, cancelar, entregar, retirar): eso va aparte. Solo propone: el usuario confirma.`,
      schema: z.object({
        steps: z.array(z.object({
          action: z.string().describe(`Una de: ${PLAN_ACTION_NAMES.join(', ')}`),
          origen: z.string().optional(), destino: z.string().optional(), peso: z.number().optional(),
          recipient_name: z.string().optional(), recipient_phone: z.string().optional(), sender_name: z.string().optional(), description: z.string().optional(),
          route_ref: z.string().optional().describe('Viaje: el campo ref de find_available_trips'),
          code: z.string().optional().describe('Código TRK-… o "$1" (el paquete que crea el paso 1)'),
          codes: z.array(z.string()).optional(),
          status: z.string().optional().describe('register_event: en_transito, en_agencia o siniestro'), note: z.string().optional(),
          driver_name: z.string().optional(), vehicle_plate: z.string().optional(),
          origin: z.string().optional(), destination: z.string().optional(), date: z.string().optional(), time: z.string().optional(),
          plate: z.string().optional(), brand: z.string().optional(), model: z.string().optional(), type: z.string().optional(), capacity_kg: z.number().optional(),
        })).describe('Los pasos, en el orden en que se harán'),
      }),
    }
  )];
};
