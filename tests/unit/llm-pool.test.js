import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMPool, resolvePool, classifyError } from '../../src/modules/ai-agent/llm.pool.js';

const entries = (...specs) => specs.map(([id, rpm = 30]) => ({ id, provider: id, model: `${id}-model`, rpm }));
const clock = (start = 1_000_000) => { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; };
const err = (status, message = 'x', extra = {}) => Object.assign(new Error(message), { status, ...extra });
const make = (list, opts = {}) => new LLMPool(entries(...list), { build: (e) => ({ id: e.id }), ...opts });

// ---------------------------------------------------------------- configuración
test('sin LLM_POOL se comporta como antes: solo el proveedor principal', () => {
  const { entries: e } = resolvePool({ GEMINI_API_KEY: 'g' });
  assert.deepEqual(e.map((x) => x.id), ['gemini']);
  assert.equal(e[0].model, 'gemini-flash-lite-latest');
});

test('LLM_POOL arma el pool en orden y solo con los proveedores que tienen clave', () => {
  const { entries: e, skipped } = resolvePool({ LLM_POOL: 'gemini, groq ,cerebras,openrouter,inventado', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o' });
  assert.deepEqual(e.map((x) => x.provider), ['gemini', 'groq', 'groq', 'openrouter', 'openrouter']); // Groq y OpenRouter entran con 2 modelos
  assert.deepEqual(skipped.map((s) => s.provider), ['cerebras', 'inventado']);
  assert.match(skipped[0].reason, /CEREBRAS_API_KEY/);
});

test('cada proveedor puede cambiar su modelo, límite y endpoint desde el .env', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'groq', GROQ_API_KEY: 'q', GROQ_MODEL: 'openai/gpt-oss-120b', GROQ_RPM: '10', GROQ_BASE_URL: 'http://x/v1', LLM_PROVIDER: 'groq' });
  assert.equal(e[0].model, 'openai/gpt-oss-120b');
  assert.equal(e[0].rpm, 10);
  assert.equal(e[0].baseURL, 'http://x/v1');
});

test('LLM_MODEL_NAME solo afecta al proveedor principal', () => {
  const { entries: e } = resolvePool({ LLM_PROVIDER: 'gemini', LLM_MODEL_NAME: 'gemini-pro', LLM_POOL: 'gemini,groq', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' });
  assert.equal(e.find((x) => x.id === 'gemini').model, 'gemini-pro');
  assert.equal(e.find((x) => x.provider === 'groq').model, 'openai/gpt-oss-120b');
});

test('las claves no aparecen en el estado que ve el administrador', () => {
  const pool = new LLMPool(resolvePool({ LLM_POOL: 'gemini', GEMINI_API_KEY: 'SECRETA' }).entries, { build: () => ({}) });
  assert.ok(!JSON.stringify(pool.status()).includes('SECRETA'));
});

// ---------------------------------------------------------------- clasificación de errores
test('qué errores justifican probar otro modelo', () => {
  assert.equal(classifyError(err(429)), 'rateLimited');
  assert.equal(classifyError(err(500)), 'transient');
  assert.equal(classifyError(err(503)), 'transient');
  assert.equal(classifyError(err(401)), 'unavailable');
  assert.equal(classifyError(err(404, 'The model `x` has been decommissioned')), 'unavailable');
  assert.equal(classifyError(err(undefined, 'fetch failed')), 'transient');
  assert.equal(classifyError(err(400, 'tool_use_failed: Failed to call a function')), 'transient');
  assert.equal(classifyError(Object.assign(new Error('t'), { name: 'LLMTimeoutError' })), 'transient');
  assert.equal(classifyError(err(undefined, 'Resource has been exhausted (e.g. check quota)')), 'rateLimited');
});

test('un error de la propia consulta (no del proveedor) no se reintenta', () => {
  assert.equal(classifyError(err(400, 'Invalid JSON payload')), null);
  assert.equal(classifyError(new Error('Recursion limit of 14 reached')), null);
});

// ---------------------------------------------------------------- reparto
test('reparte las consultas entre los modelos en proporción a su capacidad', async () => {
  const c = clock();
  const pool = make([['a', 30], ['b', 15]], { now: c.now });
  const used = { a: 0, b: 0 };
  for (let i = 0; i < 30; i += 1) {
    const { member } = await pool.run(async () => 'ok');
    used[member.id] += 1;
    c.tick(100);
  }
  assert.equal(used.a + used.b, 30);
  assert.ok(used.a > used.b, `a (30 rpm) debe recibir más que b (15 rpm): ${JSON.stringify(used)}`);
  assert.ok(used.b >= 8, `b también debe recibir su parte: ${JSON.stringify(used)}`);
});

test('con consultas simultáneas se usa a quien está menos ocupado', async () => {
  const pool = make([['a'], ['b'], ['c']]);
  const gates = [];
  const started = [];
  const runs = [0, 1, 2].map(() => pool.run((_m, member) => new Promise((resolve) => { started.push(member.id); gates.push(resolve); })));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...started].sort(), ['a', 'b', 'c'], 'cada consulta simultánea va a un modelo distinto');
  gates.forEach((g) => g('ok'));
  await Promise.all(runs);
});

test('no supera el límite por minuto de un modelo mientras otros tengan margen', async () => {
  const c = clock();
  const pool = make([['a', 10], ['b', 100]], { now: c.now });
  const used = { a: 0, b: 0 };
  for (let i = 0; i < 40; i += 1) {
    const { member } = await pool.run(async () => 'ok');
    used[member.id] += 1;
  }
  assert.ok(used.a <= 9, `a no debe pasar de su límite (10/min con holgura): ${JSON.stringify(used)}`);
});

test('con la estrategia "speed" se prefiere al modelo que responde más rápido', async () => {
  const c = clock();
  const pool = make([['lento', 100], ['rapido', 100]], { now: c.now, strategy: 'speed' });
  const delays = { lento: 900, rapido: 100 };
  // primero se prueba a ambos para que el balanceador conozca sus tiempos
  for (let i = 0; i < 2; i += 1) await pool.run(async (_m, member) => { c.tick(delays[member.id]); return 'ok'; });
  const picks = [];
  for (let i = 0; i < 6; i += 1) { const { member } = await pool.run(async (_m, mm) => { c.tick(delays[mm.id]); return 'ok'; }); picks.push(member.id); }
  assert.ok(picks.filter((p) => p === 'rapido').length >= 5, picks.join(','));
});

// ---------------------------------------------------------------- fallos y respaldo
test('si un modelo devuelve 429 la misma consulta se responde con otro, y el primero descansa', async () => {
  const c = clock();
  const pool = make([['a'], ['b']], { now: c.now });
  const calls = [];
  const { result, member, attempts } = await pool.run(async (_m, mm) => {
    calls.push(mm.id);
    if (mm.id === 'a') throw err(429, 'Too Many Requests');
    return 'respuesta de b';
  });
  assert.equal(result, 'respuesta de b');
  assert.equal(member.id, 'b');
  assert.equal(attempts, 2);
  assert.deepEqual(calls, ['a', 'b']);

  const a = pool.status().find((s) => s.id === 'a');
  assert.equal(a.available, false);
  assert.equal(a.cooldown_reason, 'rateLimited');
  assert.ok(a.cooldown_seconds > 0);

  // mientras descansa, ya no se le envían consultas
  const next = await pool.run(async () => 'ok');
  assert.equal(next.member.id, 'b');
  assert.equal(next.attempts, 1);

  // pasado el enfriamiento vuelve a participar
  c.tick(61_000);
  assert.equal(pool.status().find((s) => s.id === 'a').available, true);
});

test('respeta el Retry-After que indica el proveedor', async () => {
  const c = clock();
  const pool = make([['a'], ['b']], { now: c.now });
  await pool.run(async (_m, mm) => { if (mm.id === 'a') throw err(429, 'x', { headers: { 'retry-after': '120' } }); return 'ok'; });
  assert.equal(pool.status().find((s) => s.id === 'a').cooldown_seconds, 120);
});

test('un modelo retirado (404) se aparta 10 minutos y se sigue con los demás', async () => {
  const c = clock();
  const pool = make([['a'], ['b']], { now: c.now });
  await pool.run(async (_m, mm) => { if (mm.id === 'a') throw err(404, 'model_decommissioned'); return 'ok'; });
  const a = pool.status().find((s) => s.id === 'a');
  assert.equal(a.cooldown_reason, 'unavailable');
  assert.equal(a.cooldown_seconds, 600);
});

test('un modelo que no responde a tiempo se abandona y responde otro', async () => {
  const pool = make([['a'], ['b']], { timeoutMs: 30 });
  const { member } = await pool.run((_m, mm) => (mm.id === 'a' ? new Promise(() => {}) : Promise.resolve('ok')));
  assert.equal(member.id, 'b');
  assert.equal(pool.status().find((s) => s.id === 'a').cooldown_reason, 'transient');
});

test('un error de la propia consulta se propaga sin probar otros modelos', async () => {
  const pool = make([['a'], ['b']]);
  let calls = 0;
  await assert.rejects(pool.run(async () => { calls += 1; throw err(400, 'Invalid JSON payload'); }), /Invalid JSON/);
  assert.equal(calls, 1);
});

test('si todos los modelos fallan se devuelve el último error (para responder 429/503 al usuario)', async () => {
  const pool = make([['a'], ['b'], ['c']]);
  await assert.rejects(pool.run(async () => { throw err(429, 'cuota'); }), (e) => e.status === 429);
  // y con todos enfriándose, la siguiente consulta falla rápido y claro
  await assert.rejects(pool.run(async () => 'ok'), (e) => e.status === 503);
});

test('no reintenta cuando canRetry lo impide (p. ej. ya se creó una propuesta de acción)', async () => {
  const pool = make([['a'], ['b']]);
  let calls = 0;
  await assert.rejects(pool.run(async () => { calls += 1; throw err(500, 'boom'); }, { canRetry: () => false }));
  assert.equal(calls, 1);
});

test('el contador de consultas en curso vuelve a cero aunque falle', async () => {
  const pool = make([['a']]);
  await assert.rejects(pool.run(async () => { throw err(400, 'mala consulta'); }));
  assert.equal(pool.status()[0].in_flight, 0);
});

test('registra éxitos, fallos y tiempo medio por modelo', async () => {
  const c = clock();
  const pool = make([['a']], { now: c.now });
  await pool.run(async () => { c.tick(200); return 'ok'; });
  await assert.rejects(pool.run(async () => { throw err(400, 'x'); }));
  const s = pool.status()[0];
  assert.equal(s.ok, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.avg_ms, 200);
});

// ---------------------------------------------------------------- varios modelos del mismo proveedor y tokens por minuto
test('Groq entra con varios modelos, cada uno por separado (el proveedor limita por modelo)', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'groq', GROQ_API_KEY: 'q' });
  assert.deepEqual(e.map((x) => x.id), ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b']);
  assert.ok(e.every((x) => x.tpm === 8000 && x.provider === 'groq'));
});

test('<PROVEEDOR>_MODELS define la lista de modelos y <PROVEEDOR>_TPM el tope de tokens', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'groq', GROQ_API_KEY: 'q', GROQ_MODELS: 'a, b ,c', GROQ_TPM: '6000' });
  assert.deepEqual(e.map((x) => x.model), ['a', 'b', 'c']);
  assert.equal(e[0].tpm, 6000);
});

test('con un solo modelo el id sigue siendo el nombre del proveedor', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'groq', GROQ_API_KEY: 'q', GROQ_MODEL: 'solo' });
  assert.deepEqual(e.map((x) => x.id), ['groq']);
});

test('respeta los tokens por minuto: si un modelo ya gastó su presupuesto, la consulta va a otro', async () => {
  const c = clock();
  const list = [{ id: 'chico', provider: 'x', model: 'm', rpm: 100, tpm: 8000 }, { id: 'grande', provider: 'x', model: 'm', rpm: 100 }];
  const pool = new LLMPool(list, { build: () => ({}), now: c.now });
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    const { member } = await pool.run(async () => 'ok', { tokensOf: () => 3500 });
    order.push(member.id);
    c.tick(500);
  }
  const chico = order.filter((x) => x === 'chico').length;
  assert.ok(chico <= 2, `chico (8 000 tokens/min) no puede recibir más de 2 consultas de 3 500 tokens por minuto: ${order}`);
  assert.ok(pool.status().find((x) => x.id === 'chico').tokens_last_minute <= 8000);
});

test('pasado el minuto, los tokens se liberan y el modelo vuelve a recibir consultas', async () => {
  const c = clock();
  const pool = new LLMPool([{ id: 'a', provider: 'x', model: 'm', rpm: 100, tpm: 8000 }], { build: () => ({}), now: c.now });
  await pool.run(async () => 'ok', { tokensOf: () => 7500 });
  assert.equal(pool.status()[0].tokens_last_minute, 7500);
  c.tick(61_000);
  assert.equal(pool.status()[0].tokens_last_minute, 0);
});

test('Cerebras entra con sus dos modelos y cada uno con su propio límite', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'cerebras', CEREBRAS_API_KEY: 'c' });
  const q = e.find((x) => x.model === 'qwen-3.8-27b');
  const g = e.find((x) => x.model === 'gpt-oss-120b');
  assert.equal(q.rpm, 450);
  assert.equal(q.tpm, 150000);
  assert.equal(g.rpm, 5);
  assert.equal(g.tpm, 30000);
});

test('un modelo con más capacidad recibe proporcionalmente más consultas', async () => {
  const c = clock();
  const list = [{ id: 'grande', provider: 'x', model: 'm', rpm: 450, tpm: 150000 }, { id: 'chico', provider: 'x', model: 'm', rpm: 5, tpm: 30000 }];
  const pool = new LLMPool(list, { build: () => ({}), now: c.now });
  const used = { grande: 0, chico: 0 };
  for (let i = 0; i < 30; i += 1) { const { member } = await pool.run(async () => 'ok', { tokensOf: () => 2000 }); used[member.id] += 1; c.tick(1000); }
  assert.ok(used.chico <= 4, `el de 5 rpm no debe pasar de su límite: ${JSON.stringify(used)}`);
  assert.ok(used.grande >= 26, JSON.stringify(used));
});

test('OpenRouter entra como respaldo, con dos modelos gratuitos', () => {
  const { entries: e } = resolvePool({ LLM_POOL: 'openrouter', OPENROUTER_API_KEY: 'o' });
  assert.equal(e.length, 2);
  assert.ok(e.every((x) => x.backup === true && x.model.endsWith(':free')));
  assert.equal(resolvePool({ LLM_POOL: 'openrouter', OPENROUTER_API_KEY: 'o', OPENROUTER_BACKUP: 'false' }).entries[0].backup, false);
});

test('los de respaldo no reciben consultas mientras haya un principal con margen', async () => {
  const c = clock();
  const list = [{ id: 'principal', provider: 'x', model: 'm', rpm: 100 }, { id: 'respaldo', provider: 'x', model: 'm', rpm: 100, backup: true }];
  const pool = new LLMPool(list, { build: () => ({}), now: c.now });
  const used = { principal: 0, respaldo: 0 };
  for (let i = 0; i < 20; i += 1) { const { member } = await pool.run(async () => 'ok'); used[member.id] += 1; c.tick(100); }
  assert.deepEqual(used, { principal: 20, respaldo: 0 });
});

test('si el principal cae o se llena, el respaldo atiende', async () => {
  const c = clock();
  const list = [{ id: 'principal', provider: 'x', model: 'm', rpm: 100 }, { id: 'respaldo', provider: 'x', model: 'm', rpm: 100, backup: true }];
  const pool = new LLMPool(list, { build: () => ({}), now: c.now });
  const r = await pool.run(async (_m, mm) => { if (mm.id === 'principal') throw err(503, 'caído'); return 'ok'; });
  assert.equal(r.member.id, 'respaldo');
  // mientras el principal descansa, todo va al respaldo
  assert.equal((await pool.run(async () => 'ok')).member.id, 'respaldo');
});

test('cuenta cada llamada al modelo (no cada consulta) contra el límite por minuto', async () => {
  const c = clock();
  const pool = new LLMPool([{ id: 'g', provider: 'x', model: 'm', rpm: 15 }, { id: 'otro', provider: 'x', model: 'm', rpm: 15 }], { build: () => ({}), now: c.now });
  // cada consulta hace 3 llamadas: con 15 rpm solo caben ~4 consultas por minuto en cada uno
  const used = { g: 0, otro: 0 };
  for (let i = 0; i < 8; i += 1) { const { member } = await pool.run(async () => 'ok', { callsOf: () => 3 }); used[member.id] += 1; c.tick(500); }
  assert.ok(used.g <= 4 && used.otro <= 4, JSON.stringify(used));
  assert.ok(pool.status().every((s) => s.requests_last_minute <= 13), JSON.stringify(pool.status().map((s) => s.requests_last_minute)));
});

