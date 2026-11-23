import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installProcessGuards, isProviderError } from '../../src/shared/utils/processGuards.js';

const fakeProcess = () => {
  const proc = new EventEmitter();
  proc.exitCode = null;
  proc.exit = (code) => { proc.exitCode = code; };
  return proc;
};
const silent = { error() {} };

describe('processGuards', () => {
  it('reconoce los errores de los proveedores de IA', () => {
    const err = Object.assign(new Error('[GoogleGenerativeAI Error]: Failed to parse stream'), { name: 'GoogleGenerativeAIError' });
    assert.equal(isProviderError(err), true);
    assert.equal(isProviderError(new Error('Failed to parse stream')), true);
    assert.equal(isProviderError(new Error('columna inexistente en la base')), false);
    assert.equal(isProviderError(undefined), false);
  });

  it('un error de un proveedor de IA sin capturar NO termina el proceso', () => {
    const proc = fakeProcess();
    installProcessGuards(proc, silent);
    proc.emit('unhandledRejection', Object.assign(new Error('Failed to parse stream'), { name: 'GoogleGenerativeAIError' }));
    assert.equal(proc.exitCode, null);
  });

  it('cualquier otro rechazo sin capturar sigue terminando el proceso', () => {
    const proc = fakeProcess();
    installProcessGuards(proc, silent);
    proc.emit('unhandledRejection', new Error('fallo inesperado en el servicio'));
    assert.equal(proc.exitCode, 1);
  });
});
