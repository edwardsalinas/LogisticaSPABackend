import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLLMConfig, getLLM, DEFAULT_PROVIDER } from '../../src/modules/ai-agent/ai-agent.service.js';


test('el proveedor por defecto es Gemini (Google) con el cliente oficial de Google', () => {
  const c = resolveLLMConfig({ GEMINI_API_KEY: 'k' });
  assert.equal(DEFAULT_PROVIDER, 'gemini');
  assert.equal(c.provider, 'gemini');
  assert.equal(c.baseURL, undefined);
  assert.equal(c.model, 'gemini-flash-lite-latest');
  assert.equal(c.apiKey, 'k');
  assert.equal(c.temperature, undefined); // con Gemini se usa la temperatura del proveedor
});

test('la clave de Gemini se toma de GEMINI_API_KEY, GOOGLE_API_KEY o LLM_API_KEY (en ese orden)', () => {
  assert.equal(resolveLLMConfig({ GEMINI_API_KEY: 'a', GOOGLE_API_KEY: 'b', LLM_API_KEY: 'c' }).apiKey, 'a');
  assert.equal(resolveLLMConfig({ GOOGLE_API_KEY: 'b', LLM_API_KEY: 'c' }).apiKey, 'b');
  assert.equal(resolveLLMConfig({ LLM_API_KEY: 'c' }).apiKey, 'c');
  assert.equal(resolveLLMConfig({}).apiKey, undefined);
});

test('LLM_MODEL_NAME, LLM_BASE_URL y LLM_TEMPERATURE sobrescriben los valores por defecto', () => {
  const c = resolveLLMConfig({ LLM_MODEL_NAME: 'gemini-otro', LLM_BASE_URL: 'http://localhost:11434/v1', LLM_TEMPERATURE: '0.2' });
  assert.equal(c.model, 'gemini-otro');
  assert.equal(c.baseURL, 'http://localhost:11434/v1');
  assert.equal(c.temperature, 0.2);
});

test('Qwen sigue disponible como alternativa', () => {
  const c = resolveLLMConfig({ LLM_PROVIDER: 'qwen', LLM_API_KEY: 'q' });
  assert.equal(c.provider, 'qwen');
  assert.match(c.baseURL, /dashscope/);
  assert.equal(c.model, 'qwen-plus');
  assert.equal(c.temperature, 0);
});

test('OpenAI usa su endpoint oficial (sin baseURL) y OPENAI_API_KEY', () => {
  const c = resolveLLMConfig({ LLM_PROVIDER: 'OpenAI', OPENAI_API_KEY: 'o' });
  assert.equal(c.provider, 'openai');
  assert.equal(c.baseURL, undefined);
  assert.equal(c.apiKey, 'o');
  assert.equal(c.model, 'gpt-4o-mini');
});

test('un proveedor desconocido vuelve al predeterminado', () => {
  const c = resolveLLMConfig({ LLM_PROVIDER: 'inexistente' });
  assert.equal(c.requested, 'inexistente');
  assert.equal(c.provider, 'gemini');
});

test('getLLM construye el cliente oficial de Google para Gemini', () => {
  const previous = { ...process.env };
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  delete process.env.LLM_PROVIDER;
  try {
    const llm = getLLM();
    assert.equal(llm.constructor.name, 'ChatGoogleGenerativeAI');
    assert.match(llm.model, /gemini-flash-lite-latest/);
  } finally {
    process.env = previous;
  }
});
