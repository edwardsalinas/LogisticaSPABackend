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

    const exec = () => {
      if (failures.has(name)) return { data: null, error: new Error(`fallo simulado en ${name}`) };
      if (q.op === 'insert') {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        const inserted = list.map((p) => ({ id: fakeUuid(), created_at: new Date().toISOString(), ...copy(p) }));
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
