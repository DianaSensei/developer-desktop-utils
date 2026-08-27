import { describe, expect, it } from 'vitest';
import { buildResolvedVars } from './vars';
import { newEnvironment, newKeyValue } from './types';

describe('buildResolvedVars', () => {
  it('tags each variable with the source it came from', () => {
    const env = newEnvironment('Dev', null, [{ ...newKeyValue('token', 'abc'), enabled: true }]);
    const result = buildResolvedVars({ baseUrl: 'https://api.test' }, { sessionId: 's1' }, env, [
      { ...newKeyValue('apiKey', 'k1'), enabled: true },
    ]);
    expect(result).toEqual([
      { name: 'baseUrl', value: 'https://api.test', secret: false, source: 'collection' },
      { name: 'sessionId', value: 's1', secret: false, source: 'runtime' },
      { name: 'token', value: 'abc', secret: false, source: 'env' },
      { name: 'vault.apiKey', value: '••••••••', secret: true, source: 'vault' },
    ]);
  });

  it('precedence: env overrides runtime overrides collection for the same name', () => {
    const env = newEnvironment('Dev', null, [{ ...newKeyValue('host', 'from-env'), enabled: true }]);
    const result = buildResolvedVars({ host: 'from-collection' }, { host: 'from-runtime' }, env, []);
    expect(result).toEqual([{ name: 'host', value: 'from-env', secret: false, source: 'env' }]);
  });

  it('runtime overrides collection when there is no environment value for the same name', () => {
    const result = buildResolvedVars({ host: 'from-collection' }, { host: 'from-runtime' }, null, []);
    expect(result).toEqual([{ name: 'host', value: 'from-runtime', secret: false, source: 'runtime' }]);
  });

  it('marks an env variable secret only when its own `secret` flag is set', () => {
    const env = newEnvironment('Dev', null, [
      { ...newKeyValue('public', 'p'), enabled: true },
      { ...newKeyValue('private', 's'), enabled: true, secret: true },
    ]);
    const result = buildResolvedVars({}, {}, env, []);
    expect(result).toEqual([
      { name: 'private', value: 's', secret: true, source: 'env' },
      { name: 'public', value: 'p', secret: false, source: 'env' },
    ]);
  });

  it('never reads a real Vault value — always the fixed masked placeholder', () => {
    const result = buildResolvedVars({}, {}, null, [{ ...newKeyValue('secretKey', 'the-real-secret'), enabled: true }]);
    expect(result).toEqual([{ name: 'vault.secretKey', value: '••••••••', secret: true, source: 'vault' }]);
    expect(JSON.stringify(result)).not.toContain('the-real-secret');
  });

  it('excludes disabled env/Vault rows and empty-key rows', () => {
    const env = newEnvironment('Dev', null, [
      { ...newKeyValue('disabled', 'x'), enabled: false },
      { ...newKeyValue('', 'y'), enabled: true },
    ]);
    const vault = [
      { ...newKeyValue('disabledVault', 'x'), enabled: false },
      { ...newKeyValue('', 'y'), enabled: true },
    ];
    expect(buildResolvedVars({}, {}, env, vault)).toEqual([]);
  });

  it('is sorted by name', () => {
    const result = buildResolvedVars({ zeta: '1', alpha: '2' }, {}, null, []);
    expect(result.map((r) => r.name)).toEqual(['alpha', 'zeta']);
  });

  it('returns an empty list when nothing is in scope anywhere', () => {
    expect(buildResolvedVars({}, {}, null, [])).toEqual([]);
  });
});
