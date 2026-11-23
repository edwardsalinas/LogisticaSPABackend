/**
 * Balanceador de modelos de lenguaje.
 *
 * Reparte las consultas entre varios proveedores (cada uno con su propio límite gratuito) y, si uno falla o se
 * satura, la misma consulta se reintenta en otro sin que el usuario lo note. Qué gana el sistema:
 *   - Capacidad: los límites se suman (p. ej. 15 + 30 + 30 peticiones por minuto en vez de 15).
 *   - Disponibilidad: si un proveedor cae, se agota su cuota o retira un modelo, los demás siguen respondiendo.
 *   - Velocidad: cada respuesta usa al modelo menos cargado; con proveedores rápidos (Groq, Cerebras) cada
 *     respuesta también es más corta. Con 'speed' se prefiere al que viene respondiendo más rápido.
 *
 * Configuración (.env):
 *   LLM_POOL=gemini,groq,cerebras,openrouter   orden de preferencia; solo se usan los que tienen clave
 *   LLM_STRATEGY=balanced | speed              balanced reparte por carga; speed prefiere al más rápido
 *   LLM_TIMEOUT_MS=30000                       tiempo máximo por intento antes de pasar a otro modelo
 *   <PROVEEDOR>_API_KEY, <PROVEEDOR>_MODEL(S), <PROVEEDOR>_RPM, <PROVEEDOR>_TPM   clave, modelo(s), peticiones y tokens por minuto
 *   (con <PROVEEDOR>_MODELS=a,b cada modelo entra al pool por separado, porque los proveedores limitan por modelo)
 */

export const POOL_PROVIDERS = {
  gemini: { baseURL: undefined, model: 'gemini-flash-lite-latest', keyVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_API_KEY'], rpm: 15 },
  // Groq limita por MODELO (plan gratuito: 8 000 tokens/min y 1 000 peticiones/día cada uno): varios modelos suman capacidad
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], keyVars: ['GROQ_API_KEY'], rpm: 30, tpm: 8000 },
  cerebras: { baseURL: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', keyVars: ['CEREBRAS_API_KEY'], rpm: 30 },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyVars: ['OPENROUTER_API_KEY'], rpm: 15 },
  qwen: { baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyVars: ['DASHSCOPE_API_KEY', 'LLM_API_KEY'], rpm: 30 },
  openai: { baseURL: undefined, model: 'gpt-4o-mini', keyVars: ['OPENAI_API_KEY', 'LLM_API_KEY'], rpm: 30 },
};

const WINDOW_MS = 60 * 1000;
const COOLDOWN = { rateLimited: 60 * 1000, transient: 30 * 1000, unavailable: 10 * 60 * 1000 };

const num = (v, fallback) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Qué proveedores componen el pool, con modelo, límite y clave. Función pura (fácil de probar).
 * Sin LLM_POOL se comporta como antes: un solo proveedor (LLM_PROVIDER, Gemini por defecto).
 */
export const resolvePool = (env = process.env) => {
  const requested = (env.LLM_PROVIDER || 'gemini').toLowerCase();
  const names = (env.LLM_POOL ? env.LLM_POOL.split(',') : [requested]).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(names)];
  const skipped = [];
  const entries = [];

  for (const name of unique) {
    const spec = POOL_PROVIDERS[name];
    if (!spec) { skipped.push({ provider: name, reason: 'proveedor no soportado' }); continue; }
    const upper = name.toUpperCase();
    const apiKey = spec.keyVars.map((k) => env[k]).find(Boolean);
    if (!apiKey) { skipped.push({ provider: name, reason: `falta la clave (${spec.keyVars[0]})` }); continue; }
    const listed = (env[`${upper}_MODELS`] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    // LLM_MODEL_NAME (la variable de siempre) vale para el proveedor principal; los demás usan <PROVEEDOR>_MODEL(S)
    const models = listed.length ? listed
      : env[`${upper}_MODEL`] ? [env[`${upper}_MODEL`]]
        : name === requested && env.LLM_MODEL_NAME ? [env.LLM_MODEL_NAME]
          : (spec.models ?? [spec.model]);
    for (const model of models) {
      entries.push({
        id: models.length > 1 ? `${name}:${model}` : name,
        provider: name,
        model,
        baseURL: env[`${upper}_BASE_URL`] || (name === requested && env.LLM_BASE_URL) || spec.baseURL,
        apiKey,
        rpm: num(env[`${upper}_RPM`], spec.rpm),
        tpm: num(env[`${upper}_TPM`], spec.tpm), // undefined = sin tope conocido de tokens por minuto
        temperature: name === 'gemini' ? undefined : num(env.LLM_TEMPERATURE, 0),
      });
    }
  }
  return { entries, skipped };
};

/** ¿Vale la pena reintentar la misma consulta en otro modelo? Devuelve null si no, o el tipo de enfriamiento. */
export const classifyError = (error) => {
  const status = Number(error?.status ?? error?.response?.status ?? error?.statusCode);
  const text = `${error?.message ?? ''} ${error?.code ?? ''} ${error?.error?.code ?? ''}`.toLowerCase();

  if (error?.name === 'LLMTimeoutError') return 'transient';
  if (status === 429 || /rate.?limit|quota|too many requests|resource.?exhausted/.test(text)) return 'rateLimited';
  if (status === 401 || status === 403) return 'unavailable'; // clave inválida o sin permiso
  // modelo retirado o inexistente (los proveedores gratuitos los cambian seguido)
  if (status === 404 || /decommission|deprecated|model.*(not found|does not exist)|no longer supported/.test(text)) return 'unavailable';
  if (status === 408 || status >= 500) return 'transient';
  if (/econnreset|etimedout|enotfound|econnrefused|fetch failed|socket hang up|network/.test(text)) return 'transient';
  // modelos pequeños que arman mal la llamada a una herramienta: otro modelo suele resolverlo
  if (/tool_use_failed|failed to call a function|failed_generation|malformed.*function|invalid.*tool/.test(text)) return 'transient';
  return null;
};

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`El modelo no respondió en ${ms} ms`), { name: 'LLMTimeoutError' })), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });

export class LLMPool {
  /**
   * @param {object[]} entries salida de resolvePool(...).entries
   * @param {{ build: (entry) => object, now?: () => number, strategy?: 'balanced'|'speed', timeoutMs?: number, maxAttempts?: number }} options
   */
  constructor(entries, { build, now = Date.now, strategy = 'balanced', timeoutMs = 30000, maxAttempts = 3 } = {}) {
    if (typeof build !== 'function') throw new Error('LLMPool necesita una función build(entry) que cree el modelo');
    this.build = build;
    this.now = now;
    this.strategy = strategy;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.members = entries.map((e) => ({ ...e, model_instance: null, inFlight: 0, stamps: [], tokenStamps: [], avgTokens: 0, cooldownUntil: 0, cooldownReason: null, ewmaMs: 0, lastUsed: 0, ok: 0, failed: 0, lastError: null }));
  }

  get size() { return this.members.length; }

  #recent(m) {
    const cut = this.now() - WINDOW_MS;
    m.stamps = m.stamps.filter((t) => t > cut);
    return m.stamps.length;
  }

  /** Tokens gastados en el último minuto (según lo que informó el proveedor). */
  #tokensLastMinute(m) {
    const cut = this.now() - WINDOW_MS;
    m.tokenStamps = m.tokenStamps.filter((x) => x.t > cut);
    return m.tokenStamps.reduce((n, x) => n + x.n, 0);
  }

  /** ¿Cabe otra consulta típica en el presupuesto de tokens por minuto de este modelo? */
  #hasTokenRoom(m) {
    if (!m.tpm) return true;
    return this.#tokensLastMinute(m) + (m.avgTokens || 0) <= m.tpm * 0.95;
  }

  /** El miembro más adecuado ahora (o null si no queda ninguno fuera de enfriamiento). */
  pick(excluded = new Set()) {
    const now = this.now();
    const ready = this.members.filter((m) => !excluded.has(m.id) && m.cooldownUntil <= now);
    if (ready.length === 0) return null;

    // Preferir a los que aún tienen margen dentro de su límite por minuto (se deja 10 % de holgura)
    const withRoom = ready.filter((m) => this.#recent(m) < Math.max(1, Math.floor(m.rpm * 0.9)) && this.#hasTokenRoom(m));
    const pool = withRoom.length ? withRoom : ready;

    // Carga relativa: lo ya usado este minuto respecto a su capacidad, más lo que está en curso
    const load = (m) => Math.max(this.#recent(m) / m.rpm, m.tpm ? this.#tokensLastMinute(m) / m.tpm : 0) + m.inFlight * 0.5;
    const rank = this.strategy === 'speed'
      ? (a, b) => (a.ewmaMs || 0) - (b.ewmaMs || 0) || load(a) - load(b)
      : (a, b) => load(a) - load(b) || (a.ewmaMs || 0) - (b.ewmaMs || 0) || a.lastUsed - b.lastUsed;
    return [...pool].sort(rank)[0];
  }

  #cool(m, kind, error) {
    const retryAfter = Number(error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after']);
    const ms = kind === 'rateLimited' && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5 * 60 * 1000) : COOLDOWN[kind];
    m.cooldownUntil = this.now() + ms;
    m.cooldownReason = kind;
  }

  /**
   * Ejecuta `fn(model, member)` en el mejor modelo; si falla de forma recuperable lo reintenta en otro.
   * `canRetry()` permite abortar el reintento (p. ej. si la consulta ya tuvo efectos que no deben repetirse).
   * `tokensOf(result)` informa cuántos tokens gastó la consulta, para respetar el tope por minuto de cada modelo.
   * Devuelve { result, member, attempts }.
   */
  async run(fn, { canRetry = () => true, tokensOf = () => 0 } = {}) {
    const tried = new Set();
    let lastError;
    for (let attempt = 1; attempt <= Math.min(this.maxAttempts, this.size); attempt += 1) {
      const m = this.pick(tried);
      if (!m) break;
      tried.add(m.id);
      m.inFlight += 1;
      m.stamps.push(this.now());
      m.lastUsed = this.now();
      const started = this.now();
      try {
        m.model_instance ??= this.build(m);
        const result = await withTimeout(Promise.resolve(fn(m.model_instance, m)), this.timeoutMs);
        const took = this.now() - started;
        m.ewmaMs = m.ewmaMs ? m.ewmaMs * 0.7 + took * 0.3 : took;
        m.ok += 1;
        m.lastError = null;
        const used = Number(tokensOf(result)) || 0;
        if (used > 0) {
          m.tokenStamps.push({ t: this.now(), n: used });
          m.avgTokens = m.avgTokens ? m.avgTokens * 0.7 + used * 0.3 : used;
        }
        return { result, member: m, attempts: attempt };
      } catch (error) {
        m.failed += 1;
        m.lastError = String(error?.message ?? error).slice(0, 160);
        lastError = error;
        const kind = classifyError(error);
        if (!kind) throw error; // error de la propia consulta (no del proveedor): otro modelo no lo arregla
        this.#cool(m, kind, error);
        console.warn(`[LLM Pool] ${m.id} (${m.model}) falló (${kind}): ${m.lastError}. Se prueba con otro modelo.`);
        if (!canRetry(error)) throw error;
      } finally {
        m.inFlight -= 1;
      }
    }
    // Ninguno pudo responder: se propaga el último error (el controlador lo traduce a 429/503 si corresponde)
    throw lastError ?? Object.assign(new Error('No hay modelos disponibles en este momento'), { status: 503 });
  }

  /** Estado para el panel de administración (sin claves). */
  status() {
    const now = this.now();
    return this.members.map((m) => ({
      id: m.id,
      model: m.model,
      rpm: m.rpm,
      tpm: m.tpm ?? null,
      tokens_last_minute: this.#tokensLastMinute(m),
      in_flight: m.inFlight,
      requests_last_minute: this.#recent(m),
      ok: m.ok,
      failed: m.failed,
      avg_ms: Math.round(m.ewmaMs),
      available: m.cooldownUntil <= now,
      cooldown_seconds: m.cooldownUntil > now ? Math.ceil((m.cooldownUntil - now) / 1000) : 0,
      cooldown_reason: m.cooldownUntil > now ? m.cooldownReason : null,
      last_error: m.lastError,
    }));
  }
}
