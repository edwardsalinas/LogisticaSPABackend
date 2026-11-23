/**
 * Evaluación del asistente de IA: ejecuta un conjunto fijo de preguntas contra uno o varios modelos y mide
 * aciertos (¿usó la herramienta correcta? ¿respondió bien? ¿respetó los permisos?), tiempo y tokens.
 *
 *   npm run ai:eval                                          # el pool tal como está configurado en .env
 *   npm run ai:eval -- --members cerebras:qwen-3.8-27b,gemini
 *   npm run ai:eval -- --members groq:openai/gpt-oss-20b --only track-code,ops-summary
 *   npm run ai:eval -- --label despues-de-reducir-tokens
 *
 * Usa el LLM real y la base real, pero solo LEE: las acciones del asistente quedan como propuestas en memoria y
 * nunca se confirman. Guarda el detalle en tests/ai-evals/results/ (ignorado por git).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const members = (arg('members', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const only = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const label = arg('label', 'eval');
const repeat = Number(arg('repeat', 1));

const { serviceSupabase: db } = await import('../src/shared/config/supabase.js');
const service = await import('../src/modules/ai-agent/ai-agent.service.js');
const { buildCases } = await import('../tests/ai-evals/cases.mjs');

// ------------------------------------------------------------------ datos reales para armar los casos
const { data: pkgs } = await db.from('packages').select('tracking_code, status, origen, destino, recipient_name').order('created_at', { ascending: false }).limit(1);
const { data: vehicles } = await db.from('vehicles').select('id');
if (!pkgs?.length) { console.error('Hace falta al menos un paquete en la base para evaluar.'); process.exit(1); }
const ctx = { code: pkgs[0].tracking_code, status: pkgs[0].status, origen: pkgs[0].origen, destino: pkgs[0].destino, recipient: pkgs[0].recipient_name, vehicles: vehicles?.length ?? 0 };

const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
const byEmail = Object.fromEntries((list?.users ?? []).map((u) => [u.email, u]));
const asUser = (email, role) => {
  const u = byEmail[email];
  if (!u) throw new Error(`No existe el usuario ${email}`);
  return { ...u, role };
};
const USERS = {
  admin: asUser('admin@logistica.bo', 'admin'),
  operator: asUser('operador@logistica.bo', 'logistics_operator'),
  driver: asUser('driver@logistica.bo', 'driver'),
  client: asUser('cliente@logistica.bo', 'client'),
  client2: asUser('nuevo.cliente@logistica.bo', 'client'),
};

const cases = buildCases(ctx).filter((c) => !only.length || only.includes(c.id));

// ------------------------------------------------------------------ ejecución
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runCase = async (c) => {
  const started = Date.now();
  let out;
  let error = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      out = await service.processChatMessage(c.q, { user: USERS[c.role], history: c.history ? c.history(ctx) : [], voice: !!c.voice });
      error = null;
      break;
    } catch (e) {
      error = e;
      const busy = [429, 503].includes(Number(e?.status));
      if (!busy) break;
      await sleep(attempt * 15000); // el proveedor pide esperar
    }
  }
  const ms = Date.now() - started;
  if (error || !out) return { id: c.id, role: c.role, ok: false, ms, tokens: 0, steps: 0, model: '-', failed: [`error: ${String(error?.message ?? error).slice(0, 90)}`], tools: [], text: '' };

  const used = out.trace.tools.map((t) => t.name);
  const failed = [];
  if (c.tools && !c.tools.some((t) => used.includes(t))) failed.push(`debía usar ${c.tools.join(' o ')} y usó [${used.join(', ') || 'ninguna'}]`);
  if (c.tools2 && !c.tools2.some((t) => used.includes(t))) failed.push(`debía usar también ${c.tools2.join(' o ')}`);
  for (const t of c.noTools ?? []) if (used.includes(t)) failed.push(`NO debía usar ${t}`);
  (c.answer ?? []).forEach((check, i) => { if (!check(out.text)) failed.push(`respuesta no cumple la comprobación ${i + 1}`); });
  return { id: c.id, role: c.role, ok: failed.length === 0, ms, tokens: out.trace.tokens, steps: out.trace.steps, model: out.model, failed, tools: used, text: out.text.slice(0, 220) };
};

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

const evaluate = async (name, configure) => {
  configure();
  service.resetPool();
  const pool = service.getPool();
  const m = pool.members[0];
  const results = [];
  console.log(`\n=== ${name}  (${pool.members.map((x) => x.id).join(', ')})`);
  for (let r = 0; r < repeat; r += 1) {
    for (const c of cases) {
      const t0 = Date.now();
      const res = await runCase(c);
      results.push(res);
      console.log(`${res.ok ? 'OK ' : 'MAL'} ${c.id.padEnd(26)} ${String(res.ms).padStart(6)} ms ${String(res.tokens).padStart(6)} tok ${res.steps} pasos ${res.ok ? '' : '→ ' + res.failed.join('; ')}`);
      // ritmo: respetar los topes por minuto del proveedor (tokens y llamadas)
      let wait = 0;
      if (m?.tpm && res.tokens) wait = Math.max(wait, Math.ceil((res.tokens / m.tpm) * 60000 * 1.05) - (Date.now() - t0));
      if (m?.rpm && res.steps) wait = Math.max(wait, Math.ceil((res.steps / (m.rpm * 0.8)) * 60000) - (Date.now() - t0));
      if (pool.members.length === 1 && wait > 0) await sleep(wait);
    }
  }
  const passed = results.filter((r) => r.ok);
  const summary = {
    name,
    cases: results.length,
    passed: passed.length,
    accuracy: Math.round((passed.length / results.length) * 100),
    median_ms: median(results.map((r) => r.ms)),
    p90_ms: [...results.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(results.length * 0.9)] ?? 0,
    avg_tokens: Math.round(results.reduce((n, r) => n + r.tokens, 0) / results.length),
    avg_steps: +(results.reduce((n, r) => n + r.steps, 0) / results.length).toFixed(1),
  };
  return { summary, results };
};

const all = [];
if (members.length === 0) {
  all.push(await evaluate('pool (.env)', () => {}));
} else {
  const saved = { ...process.env };
  for (const spec of members) {
    all.push(await evaluate(spec, () => {
      const [provider, ...rest] = spec.split(':');
      const model = rest.join(':');
      process.env.LLM_POOL = provider;
      process.env.LLM_PROVIDER = provider;
      for (const k of Object.keys(process.env)) if (/_MODELS?$/.test(k) && k !== 'LLM_MODEL_NAME') delete process.env[k];
      delete process.env.LLM_MODEL_NAME;
      if (model) process.env[`${provider.toUpperCase()}_MODELS`] = model;
      for (const k of ['OPENROUTER_BACKUP']) process.env[k] = 'false';
      void saved;
    }));
  }
}

console.log('\n================ RESUMEN ================');
console.log('modelo'.padEnd(40), 'aciertos', 'mediana', 'p90', 'tokens/consulta', 'pasos');
for (const { summary: s } of all) {
  console.log(s.name.padEnd(40), `${s.passed}/${s.cases} (${s.accuracy}%)`.padEnd(15), `${s.median_ms} ms`.padEnd(9), `${s.p90_ms} ms`.padEnd(9), String(s.avg_tokens).padEnd(15), s.avg_steps);
}

mkdirSync(join(here, '..', 'tests', 'ai-evals', 'results'), { recursive: true });
const file = join(here, '..', 'tests', 'ai-evals', 'results', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${label}.json`);
writeFileSync(file, JSON.stringify({ label, date: new Date().toISOString(), ctx: { ...ctx, recipient: '(oculto)' }, runs: all }, null, 2));
console.log('\nDetalle guardado en', file);
process.exit(0);
