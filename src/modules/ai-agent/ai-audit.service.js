/**
 * Auditoría y métricas de uso del asistente.
 *
 * Cada consulta deja UNA fila con métricas (modelo, herramientas, pasos, tokens, tiempo, estado). No se guarda el
 * texto de la pregunta ni de la respuesta: el panel de uso muestra cómo funciona el sistema sin exponer lo que
 * preguntó cada persona. Registrar nunca debe romper el chat: los errores se registran y se ignoran.
 */
const BOLIVIA_OFFSET_MS = -4 * 60 * 60 * 1000;
export const MAX_ROWS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Guarda la métrica de una consulta. Nunca lanza. */
export const recordChat = async (db, entry) => {
  try {
    const { error } = await db.from('ai_chat_audit').insert({
      user_id: entry.userId ?? null,
      user_role: entry.role ?? null,
      conversation_id: entry.conversationId ?? null,
      model: entry.model ?? null,
      tools: entry.tools ?? [],
      steps: entry.steps ?? null,
      tokens: entry.tokens ?? null,
      latency_ms: entry.latencyMs ?? null,
      fast_path: !!entry.fastPath,
      streamed: !!entry.streamed,
      voice: !!entry.voice,
      status: entry.status,
      error_status: entry.errorStatus ?? null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[AI Audit] No se pudo registrar la consulta:', e.message);
  }
};

// Eventos de Logi (avisos mostrados, aceptados, acciones hechas…). Se guardan en la misma tabla de auditoría con model = 'logi'
// y el nombre del evento en `tools` (sin migración nueva y, como todo lo demás, sin contenido de nadie).
export const LOGI_MODEL = 'logi';
export const LOGI_EVENTS = ['alert_shown', 'alert_accepted', 'alert_snoozed', 'alert_muted', 'guided_started', 'guided_done', 'guided_stopped', 'guided_fallback', 'demo_done'];

/** Guarda un evento de Logi. Nunca lanza. */
export const recordLogiEvent = async (db, { userId, role, event, type }) => {
  try {
    const { error } = await db.from('ai_chat_audit').insert({
      user_id: userId ?? null,
      user_role: role ?? null,
      model: LOGI_MODEL,
      tools: type ? [event, type] : [event],
      status: 'ok',
    });
    if (error) throw error;
  } catch (e) {
    console.error('[AI Audit] No se pudo registrar el evento de Logi:', e.message);
  }
};

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const dayKey = (iso) => new Date(new Date(iso).getTime() + BOLIVIA_OFFSET_MS).toISOString().slice(0, 10);

/** Resume las filas de auditoría en las cifras del panel (función pura, fácil de probar). */
export const summarize = (rows, { days, now = Date.now() } = {}) => {
  const ok = rows.filter((r) => r.status === 'ok');
  const latencies = ok.map((r) => r.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const tokens = rows.reduce((n, r) => n + (r.tokens || 0), 0);

  const group = (keyOf) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyOf(r);
      if (key == null) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  };

  const byModel = [...group((r) => r.model ?? 'sin modelo')].map(([model, list]) => {
    const good = list.filter((r) => r.status === 'ok');
    const lat = good.map((r) => r.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
    return { model, queries: list.length, ok: good.length, errors: list.length - good.length, success_pct: pct(good.length, list.length), avg_ms: avg(lat), p90_ms: percentile(lat, 0.9), tokens: list.reduce((n, r) => n + (r.tokens || 0), 0), avg_tokens: avg(list.map((r) => r.tokens || 0)) };
  }).sort((a, b) => b.queries - a.queries);

  // serie diaria completa (también los días sin consultas), con la fecha de Bolivia
  const perDay = group((r) => dayKey(r.created_at));
  const series = [];
  const span = Math.max(1, days ?? 7);
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(now - i * DAY_MS).toISOString());
    const list = perDay.get(key) ?? [];
    series.push({ date: key, queries: list.length, errors: list.filter((r) => r.status === 'error').length, tokens: list.reduce((n, r) => n + (r.tokens || 0), 0) });
  }

  const toolCount = new Map();
  for (const r of rows) for (const t of r.tools ?? []) toolCount.set(t, (toolCount.get(t) ?? 0) + 1);

  return {
    totals: {
      queries: rows.length,
      ok: ok.length,
      errors: rows.length - ok.length,
      success_pct: pct(ok.length, rows.length),
      median_ms: percentile(latencies, 0.5),
      p90_ms: percentile(latencies, 0.9),
      tokens,
      avg_tokens: rows.length ? Math.round(tokens / rows.length) : 0,
      fast_path_pct: pct(rows.filter((r) => r.fast_path).length, rows.length),
      streamed_pct: pct(rows.filter((r) => r.streamed).length, rows.length),
      voice_pct: pct(rows.filter((r) => r.voice).length, rows.length),
      active_users: new Set(rows.map((r) => r.user_id).filter(Boolean)).size,
    },
    by_model: byModel,
    by_day: series,
    top_tools: [...toolCount].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    by_role: [...group((r) => r.user_role ?? 'desconocido')].map(([role, list]) => ({ role, queries: list.length })).sort((a, b) => b.queries - a.queries),
    recent_errors: rows.filter((r) => r.status === 'error').slice(0, 5).map((r) => ({ at: r.created_at, model: r.model, status: r.error_status })),
  };
};

/** Cifras de Logi a partir de sus eventos (función pura). */
export const summarizeLogi = (rows) => {
  const count = (event, type) => rows.filter((r) => r.tools?.[0] === event && (type == null || r.tools?.[1] === type)).length;
  const types = [...new Set(rows.filter((r) => String(r.tools?.[0]).startsWith('alert_')).map((r) => r.tools?.[1]).filter(Boolean))];
  const shown = count('alert_shown');
  const accepted = count('alert_accepted');
  const started = count('guided_started');
  const done = count('guided_done');
  return {
    alerts_shown: shown,
    alerts_accepted: accepted,
    alerts_snoozed: count('alert_snoozed'),
    alerts_muted: count('alert_muted'),
    alerts_accepted_pct: pct(accepted, shown),
    guided_started: started,
    guided_done: done,
    guided_stopped: count('guided_stopped'),
    guided_fallback: count('guided_fallback'),
    guided_done_pct: pct(done, started),
    demos: count('demo_done'),
    by_alert_type: types.map((type) => ({ type, shown: count('alert_shown', type), accepted: count('alert_accepted', type) })),
  };
};

/** Informe de uso de los últimos `days` días (máximo 90). */
export const usageReport = async (db, { days = 7, now = Date.now() } = {}) => {
  const span = Math.min(Math.max(1, Number(days) || 7), 90);
  const from = new Date(now - span * DAY_MS).toISOString();
  const { data, error } = await db
    .from('ai_chat_audit')
    .select('user_id, user_role, model, tools, steps, tokens, latency_ms, fast_path, streamed, voice, status, error_status, created_at')
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  const all = data ?? [];
  // los eventos de Logi no son consultas al asistente: no cuentan en sus cifras, tienen las suyas
  const rows = all.filter((r) => r.model !== LOGI_MODEL);
  const logiRows = all.filter((r) => r.model === LOGI_MODEL);
  return { days: span, from, truncated: all.length >= MAX_ROWS, ...summarize(rows, { days: span, now }), logi: summarizeLogi(logiRows) };
};
