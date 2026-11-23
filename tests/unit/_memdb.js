/**
 * Base de datos en memoria con la forma mínima del cliente de Supabase (from().select/insert/update/delete con eq,
 * gte, order y limit). Sirve para probar servicios que escriben, sin red ni base real.
 */
let counter = 0;
const fakeUuid = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

export const memDb = (initial = {}) => {
  const tables = { ai_conversations: [], ai_messages: [], ai_chat_audit: [], ...initial };
  const failures = new Set();

  const from = (name) => {
    const q = { filters: [], order: null, limit: null, op: 'select', payload: null, returning: false };
    const rows = () => (tables[name] ??= []);

    const matching = () => {
      let r = rows().filter((row) => q.filters.every((f) => f(row)));
      if (q.order) {
        const { col, asc } = q.order;
        r = [...r].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      return q.limit != null ? r.slice(0, q.limit) : r;
    };
    const copy = (v) => JSON.parse(JSON.stringify(v));

    // Restricciones de la migración 022 (para que las pruebas fallen como fallaría PostgreSQL)
    const NOT_NULL = { ai_messages: ['conversation_id', 'role', 'content', 'attachments', 'is_error'], ai_conversations: ['user_id', 'title'], ai_chat_audit: ['status'] };
    const FOREIGN = { ai_messages: { conversation_id: 'ai_conversations' }, ai_chat_audit: { conversation_id: 'ai_conversations' } };
    const violation = (row) => {
      for (const col of NOT_NULL[name] ?? []) if (row[col] === undefined || row[col] === null) return new Error(`null value in column "${col}" of relation "${name}" violates not-null constraint`);
      for (const [col, parent] of Object.entries(FOREIGN[name] ?? {})) {
        if (row[col] != null && !(tables[parent] ?? []).some((p) => p.id === row[col])) return new Error(`insert or update on table "${name}" violates foreign key constraint on ${col}`);
      }
      return null;
    };

    const exec = () => {
      if (failures.has(name)) return { data: null, error: new Error(`fallo simulado en ${name}`) };
      if (q.op === 'insert') {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        // como PostgREST en un insert múltiple: lo que falta en una fila se envía como NULL (no se aplica el DEFAULT)
        const keys = [...new Set(list.flatMap((p) => Object.keys(p)))];
        const defaults = { attachments: [], is_error: false, tools: [], fast_path: false, streamed: false, voice: false };
        const inserted = list.map((p) => {
          const row = { id: fakeUuid(), created_at: new Date().toISOString(), ...copy(p) };
          if (list.length === 1) for (const [k, v] of Object.entries(defaults)) if (NOT_NULL[name]?.includes(k) && row[k] === undefined) row[k] = v;
          for (const k of keys) if (row[k] === undefined) row[k] = null;
          return row;
        });
        for (const row of inserted) { const bad = violation(row); if (bad) return { data: null, error: bad }; }
        rows().push(...inserted);
        return { data: q.returning ? copy(inserted) : null, error: null };
      }
      if (q.op === 'update') {
        const hit = matching();
        hit.forEach((row) => Object.assign(row, copy(q.payload)));
        return { data: q.returning ? copy(hit) : null, error: null };
      }
      if (q.op === 'delete') {
        const hit = matching();
        tables[name] = rows().filter((row) => !hit.includes(row));
        if (name === 'ai_conversations') tables.ai_messages = tables.ai_messages.filter((m) => !hit.some((c) => c.id === m.conversation_id)); // cascada
        return { data: q.returning ? copy(hit) : null, error: null };
      }
      return { data: copy(matching()), error: null };
    };

    const b = {
      select: () => { q.returning = true; return b; },
      eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
      gte: (c, v) => { q.filters.push((r) => r[c] >= v); return b; },
      lte: (c, v) => { q.filters.push((r) => r[c] <= v); return b; },
      order: (col, { ascending = true } = {}) => { q.order = { col, asc: ascending }; return b; },
      limit: (n) => { q.limit = n; return b; },
      insert: (p) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p) => { q.op = 'update'; q.payload = p; return b; },
      delete: () => { q.op = 'delete'; return b; },
      maybeSingle: async () => { const r = exec(); return r.error ? r : { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }; },
      single: async () => { const r = exec(); return r.error ? r : { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }; },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };

  return { from, tables, failOn: (name) => failures.add(name), recover: (name) => failures.delete(name) };
};
