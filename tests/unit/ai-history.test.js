import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { memDb } from './_memdb.js';
import {
  titleFrom, resolveConversation, saveTurn, listConversations, getConversation, deleteConversation, isUuid, MAX_TITLE,
} from '../../src/modules/ai-agent/ai-conversations.service.js';
import { recordChat, summarize, usageReport } from '../../src/modules/ai-agent/ai-audit.service.js';
import * as controller from '../../src/modules/ai-agent/ai-agent.controller.js';

const ANA = { id: 'u-ana', role: 'client' };
const LUIS = { id: 'u-luis', role: 'client' };
const ANSWER = { text: 'El paquete está en La Paz.', attachments: [{ kind: 'package_tracking' }] };
const res = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

// ============================================================ conversaciones
test('el título es la primera pregunta, en una línea y acotada', () => {
  assert.equal(titleFrom('  ¿Dónde   está\n mi paquete? '), '¿Dónde está mi paquete?');
  const long = titleFrom('a'.repeat(200));
  assert.ok(long.length <= MAX_TITLE && long.endsWith('…'));
  assert.equal(titleFrom('   '), 'Nueva conversación');
  assert.equal(titleFrom(null), 'Nueva conversación');
});

test('una conversación nueva se crea al guardar el primer turno, con pregunta y respuesta en orden', async () => {
  const db = memDb();
  const convo = await resolveConversation(db, ANA, undefined);
  assert.equal(convo.isNew, true);
  assert.ok(isUuid(convo.id));
  assert.equal(db.tables.ai_conversations.length, 0, 'no se escribe nada hasta que hay respuesta');

  assert.equal(await saveTurn(db, ANA, convo, { question: '¿Dónde está TRK-1?', answer: ANSWER }), true);
  assert.equal(db.tables.ai_conversations.length, 1);
  assert.equal(db.tables.ai_conversations[0].title, '¿Dónde está TRK-1?');
  assert.equal(db.tables.ai_conversations[0].user_id, ANA.id);

  const found = await getConversation(db, ANA, convo.id);
  assert.deepEqual(found.messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(found.messages[1].attachments, [{ kind: 'package_tracking' }]);
});

test('un segundo turno se agrega a la misma conversación y la sube en la lista', async () => {
  const db = memDb();
  const first = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, first, { question: 'primera', answer: ANSWER });
  const other = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, other, { question: 'otra conversación', answer: ANSWER });

  const again = await resolveConversation(db, ANA, first.id);
  assert.deepEqual(again, { id: first.id, isNew: false });
  await saveTurn(db, ANA, again, { question: 'segunda', answer: ANSWER });

  const found = await getConversation(db, ANA, first.id);
  assert.deepEqual(found.messages.map((m) => m.content).filter((c, i) => i % 2 === 0), ['primera', 'segunda']);
  assert.equal(db.tables.ai_conversations.length, 2, 'no se duplica la conversación');
});

test('SEGURIDAD: nadie lee, continúa ni borra la conversación de otro', async () => {
  const db = memDb();
  const mine = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, mine, { question: 'dato privado de Ana', answer: ANSWER });

  assert.equal(await getConversation(db, LUIS, mine.id), null, 'Luis no la ve');
  assert.equal(await deleteConversation(db, LUIS, mine.id), false, 'Luis no la borra');
  assert.equal(db.tables.ai_conversations.length, 1);
  assert.deepEqual(await listConversations(db, LUIS), []);

  // si Luis manda el id de Ana, se le abre una conversación NUEVA y no se mezcla con la de Ana
  const hijack = await resolveConversation(db, LUIS, mine.id);
  assert.equal(hijack.isNew, true);
  assert.notEqual(hijack.id, mine.id);
  await saveTurn(db, LUIS, hijack, { question: 'hola', answer: ANSWER });
  assert.equal((await getConversation(db, ANA, mine.id)).messages.length, 2, 'la de Ana no cambió');
});

test('un identificador que no es UUID se ignora sin consultar la base', async () => {
  const db = memDb();
  const r = await resolveConversation(db, ANA, "x'; drop table ai_messages;--");
  assert.equal(r.isNew, true);
  assert.equal(await getConversation(db, ANA, 'no-es-uuid'), null);
  assert.equal(await deleteConversation(db, ANA, 'no-es-uuid'), false);
});

test('la lista va de la más reciente a la más antigua y solo trae las propias', async () => {
  const db = memDb();
  for (const q of ['a', 'b', 'c']) {
    const c = await resolveConversation(db, ANA);
    await saveTurn(db, ANA, c, { question: q, answer: ANSWER });
    db.tables.ai_conversations.find((x) => x.id === c.id).updated_at = new Date(Date.now() + ['a', 'b', 'c'].indexOf(q) * 1000).toISOString();
  }
  const luis = await resolveConversation(db, LUIS);
  await saveTurn(db, LUIS, luis, { question: 'de luis', answer: ANSWER });
  const list = await listConversations(db, ANA);
  assert.deepEqual(list.map((c) => c.title), ['c', 'b', 'a']);
});

test('borrar una conversación borra también sus mensajes', async () => {
  const db = memDb();
  const c = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, c, { question: 'x', answer: ANSWER });
  assert.equal(db.tables.ai_messages.length, 2);
  assert.equal(await deleteConversation(db, ANA, c.id), true);
  assert.equal(db.tables.ai_messages.length, 0);
  assert.equal(await deleteConversation(db, ANA, c.id), false);
});

test('si guardar el historial falla, no lanza (el chat no se rompe)', async () => {
  const db = memDb();
  db.failOn('ai_messages');
  const errors = console.error;
  console.error = () => {};
  try {
    const c = await resolveConversation(db, ANA);
    assert.equal(await saveTurn(db, ANA, c, { question: 'x', answer: ANSWER }), false);
  } finally { console.error = errors; }
});

test('los textos muy largos se recortan al guardar', async () => {
  const db = memDb();
  const c = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, c, { question: 'q', answer: { text: 'x'.repeat(20000) } });
  assert.equal(db.tables.ai_messages[1].content.length, 8000);
});

// ============================================================ auditoría
const row = (over = {}) => ({ user_id: 'u1', user_role: 'admin', model: 'cerebras:qwen', tools: ['get_package_tracking'], steps: 2, tokens: 1000, latency_ms: 2000, fast_path: false, streamed: true, voice: false, status: 'ok', error_status: null, created_at: new Date().toISOString(), ...over });

test('registrar una consulta guarda métricas y NO el texto de la pregunta', async () => {
  const db = memDb();
  await recordChat(db, { userId: 'u1', role: 'admin', model: 'm', tools: ['a'], steps: 2, tokens: 900, latencyMs: 1500, fastPath: true, streamed: true, status: 'ok' });
  const saved = db.tables.ai_chat_audit[0];
  assert.equal(saved.tokens, 900);
  assert.equal(saved.fast_path, true);
  assert.deepEqual(Object.keys(saved).filter((k) => /question|message|content|text|answer/i.test(k)), [], 'sin contenido de las conversaciones');
});

test('si registrar la métrica falla, no lanza', async () => {
  const db = memDb();
  db.failOn('ai_chat_audit');
  const errors = console.error;
  console.error = () => {};
  try { await assert.doesNotReject(recordChat(db, { status: 'ok' })); } finally { console.error = errors; }
});

test('el resumen calcula aciertos, tiempos, tokens y porcentajes', () => {
  const rows = [
    row({ latency_ms: 1000, tokens: 1000 }),
    row({ latency_ms: 2000, tokens: 2000, fast_path: true }),
    row({ latency_ms: 3000, tokens: 3000 }),
    row({ latency_ms: 4000, tokens: 4000, model: 'gemini' }),
    row({ status: 'error', error_status: 429, latency_ms: 500, tokens: 0, model: 'gemini' }),
  ];
  const s = summarize(rows, { days: 1 });
  assert.equal(s.totals.queries, 5);
  assert.equal(s.totals.errors, 1);
  assert.equal(s.totals.success_pct, 80);
  assert.equal(s.totals.median_ms, 3000);
  assert.equal(s.totals.tokens, 10000);
  assert.equal(s.totals.avg_tokens, 2000);
  assert.equal(s.totals.fast_path_pct, 20);
  assert.equal(s.totals.active_users, 1);
  const gem = s.by_model.find((m) => m.model === 'gemini');
  assert.deepEqual([gem.queries, gem.errors, gem.success_pct], [2, 1, 50]);
  assert.deepEqual(s.top_tools, [{ tool: 'get_package_tracking', count: 5 }]);
  assert.equal(s.recent_errors[0].status, 429);
});

test('la serie por día incluye los días sin consultas, con fecha de Bolivia', () => {
  const now = Date.parse('2026-11-22T15:00:00Z');
  const s = summarize([row({ created_at: '2026-11-22T10:00:00Z' }), row({ created_at: '2026-11-20T10:00:00Z' })], { days: 3, now });
  assert.deepEqual(s.by_day.map((d) => [d.date, d.queries]), [['2026-11-20', 1], ['2026-11-21', 0], ['2026-11-22', 1]]);
});

test('sin datos, el resumen es cero y no falla', () => {
  const s = summarize([], { days: 7 });
  assert.equal(s.totals.queries, 0);
  assert.equal(s.totals.success_pct, 0);
  assert.equal(s.totals.median_ms, 0);
  assert.equal(s.by_day.length, 7);
});

test('el informe solo toma el período pedido', async () => {
  const db = memDb({ ai_chat_audit: [] });
  const now = Date.parse('2026-11-22T15:00:00Z');
  db.tables.ai_chat_audit.push({ id: '1', ...row({ created_at: '2026-11-21T10:00:00Z' }) }, { id: '2', ...row({ created_at: '2026-10-01T10:00:00Z' }) });
  const report = await usageReport(db, { days: 7, now });
  assert.equal(report.totals.queries, 1);
  assert.equal(report.days, 7);
});

// ============================================================ endpoints
test('GET /conversations: cada usuario ve solo las suyas', async () => {
  const db = memDb();
  controller._useDb(db);
  const c = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, c, { question: 'de Ana', answer: ANSWER });
  const l = await resolveConversation(db, LUIS);
  await saveTurn(db, LUIS, l, { question: 'de Luis', answer: ANSWER });

  const r = res();
  await controller.handleListConversations({ user: ANA }, r);
  assert.deepEqual(r.body.data.map((x) => x.title), ['de Ana']);
  controller._useDb();
});

test('GET /conversations/:id responde 404 si es ajena o no existe', async () => {
  const db = memDb();
  controller._useDb(db);
  const c = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, c, { question: 'x', answer: ANSWER });

  const own = res();
  await controller.handleGetConversation({ user: ANA, params: { id: c.id } }, own);
  assert.equal(own.code, 200);
  assert.equal(own.body.data.messages.length, 2);

  const foreign = res();
  await controller.handleGetConversation({ user: LUIS, params: { id: c.id } }, foreign);
  assert.equal(foreign.code, 404);
  controller._useDb();
});

test('DELETE /conversations/:id borra la propia y devuelve 404 con la ajena', async () => {
  const db = memDb();
  controller._useDb(db);
  const c = await resolveConversation(db, ANA);
  await saveTurn(db, ANA, c, { question: 'x', answer: ANSWER });

  const foreign = res();
  await controller.handleDeleteConversation({ user: LUIS, params: { id: c.id } }, foreign);
  assert.equal(foreign.code, 404);
  assert.equal(db.tables.ai_conversations.length, 1);

  const own = res();
  await controller.handleDeleteConversation({ user: ANA, params: { id: c.id } }, own);
  assert.equal(own.code, 200);
  assert.equal(db.tables.ai_conversations.length, 0);
  controller._useDb();
});

test('GET /usage devuelve el informe y el estado de los modelos', async () => {
  const db = memDb();
  controller._useDb(db);
  await recordChat(db, { userId: 'u1', role: 'admin', model: 'm', tools: ['a'], steps: 1, tokens: 500, latencyMs: 900, status: 'ok' });
  const r = res();
  await controller.handleUsage({ query: { days: '7' }, user: { id: 'a', role: 'admin' } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.data.totals.queries, 1);
  assert.ok(Array.isArray(r.body.data.pool.models));
  controller._useDb();
});

// ============================================================ la migración contra PostgreSQL real
test('la migración 022 crea las tablas, respeta las claves y activa RLS (PostgreSQL real con PGlite)', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    `);
    const migration = fs.readFileSync(path.resolve('migrations/022_ai_conversations_and_audit.sql'), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration); // idempotente: ejecutarla otra vez no falla

    const { rows: [u] } = await pg.query('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const { rows: [c] } = await pg.query("INSERT INTO public.ai_conversations (user_id, title) VALUES ($1, 'hola') RETURNING id", [u.id]);
    await pg.query("INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', 'x'), ($1, 'assistant', 'y')", [c.id]);
    await pg.query("INSERT INTO public.ai_chat_audit (user_id, conversation_id, status) VALUES ($1, $2, 'ok')", [u.id, c.id]);

    await assert.rejects(pg.query("INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'sistema', 'x')", [c.id]), /check/i);
    await assert.rejects(pg.query("INSERT INTO public.ai_chat_audit (status) VALUES ('raro')"), /check/i);

    const rls = await pg.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('ai_conversations','ai_messages','ai_chat_audit') ORDER BY relname");
    assert.ok(rls.rows.every((r) => r.relrowsecurity === true), 'RLS activada en las tres tablas');

    // borrar la conversación borra sus mensajes; la métrica queda (sin la referencia)
    await pg.query('DELETE FROM public.ai_conversations WHERE id = $1', [c.id]);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.ai_messages')).rows[0].n, 0);
    const audit = await pg.query('SELECT conversation_id FROM public.ai_chat_audit');
    assert.equal(audit.rows[0].conversation_id, null);

    // borrar al usuario borra sus conversaciones
    const { rows: [c2] } = await pg.query("INSERT INTO public.ai_conversations (user_id) VALUES ($1) RETURNING id", [u.id]);
    await pg.query('DELETE FROM auth.users WHERE id = $1', [u.id]);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.ai_conversations WHERE id = $1', [c2.id])).rows[0].n, 0);
  } finally {
    await pg.close();
  }
});

test('la migración 022 completa las tablas antiguas (con "metadata") sin borrar ni romper nada', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
      -- como estaban en producción antes de esta migración
      CREATE TABLE public.ai_conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, title TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE public.ai_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE CASCADE, role TEXT CHECK (role IN ('user','assistant')), content TEXT, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
    `);
    const { rows: [u] } = await pg.query('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const { rows: [c] } = await pg.query("INSERT INTO public.ai_conversations (user_id, title) VALUES ($1, 'vieja') RETURNING id", [u.id]);
    await pg.query("INSERT INTO public.ai_messages (conversation_id, role, content, metadata) VALUES ($1, 'user', 'dato previo', '{\"a\":1}')", [c.id]);

    await pg.exec(fs.readFileSync(path.resolve('migrations/022_ai_conversations_and_audit.sql'), 'utf8'));

    const old = await pg.query("SELECT content, metadata, attachments, is_error FROM public.ai_messages");
    assert.equal(old.rows.length, 1, 'el dato previo sigue ahí');
    assert.deepEqual([old.rows[0].content, old.rows[0].metadata, old.rows[0].attachments, old.rows[0].is_error], ['dato previo', { a: 1 }, [], false]);
    // el código nuevo ya puede escribir con las columnas nuevas
    await pg.query("INSERT INTO public.ai_messages (conversation_id, role, content, attachments, is_error) VALUES ($1, 'assistant', 'ok', '[{\"kind\":\"x\"}]', true)", [c.id]);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.ai_chat_audit')).rows[0].n, 0, 'la tabla de auditoría se creó');
  } finally {
    await pg.close();
  }
});

// ============================================================ regresiones encontradas en producción
test('REGRESIÓN: guardar un turno nuevo cumple NOT NULL y claves foráneas (la pregunta lleva attachments e is_error)', async () => {
  const db = memDb();
  const convo = await resolveConversation(db, ANA);
  assert.equal(await saveTurn(db, ANA, convo, { question: '¿Dónde está?', answer: { text: 'ok', attachments: [] } }), true);
  for (const m of db.tables.ai_messages) {
    assert.ok(Array.isArray(m.attachments), `${m.role} sin attachments`);
    assert.equal(typeof m.is_error, 'boolean', `${m.role} sin is_error`);
  }
});

test('REGRESIÓN: la base en memoria rechaza lo que PostgreSQL rechazaría', async () => {
  const db = memDb();
  const { error } = await db.from('ai_messages').insert([{ conversation_id: 'x', role: 'user', content: 'a' }, { conversation_id: 'x', role: 'assistant', content: 'b', attachments: [] }]);
  assert.ok(error, 'una conversación inexistente o un NULL deben fallar');
  const audit = await db.from('ai_chat_audit').insert({ status: 'ok', conversation_id: '00000000-0000-4000-8000-00000000ffff' });
  assert.match(audit.error.message, /foreign key/);
});

test('REGRESIÓN: la auditoría se guarda después de la conversación y la referencia', async () => {
  const db = memDb();
  controller._useDb(db);
  const convo = await resolveConversation(db, ANA);
  await controller.afterAnswer({
    req: { user: ANA }, body: { message: 'hola', voice: false }, convo,
    out: { text: 'ok', attachments: [], model: 'm:x', trace: { tools: [{ name: 'a' }], steps: 1, tokens: 10 } },
    started: Date.now(), streamed: true,
  });
  assert.equal(db.tables.ai_conversations.length, 1);
  assert.equal(db.tables.ai_messages.length, 2);
  assert.equal(db.tables.ai_chat_audit.length, 1, 'la métrica se registró');
  assert.equal(db.tables.ai_chat_audit[0].conversation_id, convo.id);
  controller._useDb();
});

test('si no se pudo guardar la conversación, la métrica se registra igual pero sin referenciarla', async () => {
  const db = memDb();
  db.failOn('ai_messages');
  controller._useDb(db);
  const errors = console.error;
  console.error = () => {};
  try {
    const convo = await resolveConversation(db, ANA);
    await controller.afterAnswer({ req: { user: ANA }, body: { message: 'x' }, convo, out: { text: 'ok', attachments: [], trace: { tools: [], steps: 1, tokens: 5 } }, started: Date.now(), streamed: false });
  } finally { console.error = errors; controller._useDb(); }
  assert.equal(db.tables.ai_chat_audit.length, 1);
  assert.equal(db.tables.ai_chat_audit[0].conversation_id, null);
});
