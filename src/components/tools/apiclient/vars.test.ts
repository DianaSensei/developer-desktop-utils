import { describe, expect, it } from 'vitest';
import { buildResolvedVars, substituteVars } from './vars';
import { newEnvironment, newKeyValue } from './types';

describe('buildResolvedVars', () => {
  it('tags each variable with the source it came from', () => {
    const collectionEnv = newEnvironment('Dev', 'c1', [{ ...newKeyValue('token', 'abc'), enabled: true }]);
    const result = buildResolvedVars({ baseUrl: 'https://api.test' }, collectionEnv, null, [
      { ...newKeyValue('apiKey', 'k1'), enabled: true },
    ]);
    expect(result).toEqual([
      { name: 'baseUrl', value: 'https://api.test', secret: false, source: 'collectionVar' },
      { name: 'token', value: 'abc', secret: false, source: 'collectionEnv' },
      { name: 'vault.apiKey', value: '••••••••', secret: true, source: 'vault' },
    ]);
  });

  it('precedence: collection env overrides collection var for the same name', () => {
    const collectionEnv = newEnvironment('Dev', 'c1', [{ ...newKeyValue('host', 'from-env'), enabled: true }]);
    const result = buildResolvedVars({ host: 'from-collection' }, collectionEnv, null, []);
    expect(result).toEqual([{ name: 'host', value: 'from-env', secret: false, source: 'collectionEnv' }]);
  });

  it('collection env overrides global env for the same name', () => {
    const collectionEnv = newEnvironment('Dev', 'c1', [{ ...newKeyValue('host', 'from-collection-env'), enabled: true }]);
    const globalEnv = newEnvironment('Shared', null, [{ ...newKeyValue('host', 'from-global-env'), enabled: true }]);
    const result = buildResolvedVars({}, collectionEnv, globalEnv, []);
    expect(result).toEqual([{ name: 'host', value: 'from-collection-env', secret: false, source: 'collectionEnv' }]);
  });

  it('global env overrides collection var when there is no collection env value for the same name', () => {
    const globalEnv = newEnvironment('Shared', null, [{ ...newKeyValue('host', 'from-global-env'), enabled: true }]);
    const result = buildResolvedVars({ host: 'from-collection-var' }, null, globalEnv, []);
    expect(result).toEqual([{ name: 'host', value: 'from-global-env', secret: false, source: 'globalEnv' }]);
  });

  it('marks a collection/global env variable secret only when its own `secret` flag is set', () => {
    const collectionEnv = newEnvironment('Dev', 'c1', [
      { ...newKeyValue('public', 'p'), enabled: true },
      { ...newKeyValue('private', 's'), enabled: true, secret: true },
    ]);
    const result = buildResolvedVars({}, collectionEnv, null, []);
    expect(result).toEqual([
      { name: 'private', value: 's', secret: true, source: 'collectionEnv' },
      { name: 'public', value: 'p', secret: false, source: 'collectionEnv' },
    ]);
  });

  it('never reads a real Vault value — always the fixed masked placeholder', () => {
    const result = buildResolvedVars({}, null, null, [{ ...newKeyValue('secretKey', 'the-real-secret'), enabled: true }]);
    expect(result).toEqual([{ name: 'vault.secretKey', value: '••••••••', secret: true, source: 'vault' }]);
    expect(JSON.stringify(result)).not.toContain('the-real-secret');
  });

  it('excludes disabled env/Vault rows and empty-key rows', () => {
    const collectionEnv = newEnvironment('Dev', 'c1', [
      { ...newKeyValue('disabled', 'x'), enabled: false },
      { ...newKeyValue('', 'y'), enabled: true },
    ]);
    const vault = [
      { ...newKeyValue('disabledVault', 'x'), enabled: false },
      { ...newKeyValue('', 'y'), enabled: true },
    ];
    expect(buildResolvedVars({}, collectionEnv, null, vault)).toEqual([]);
  });

  it('is sorted by name', () => {
    const result = buildResolvedVars({ zeta: '1', alpha: '2' }, null, null, []);
    expect(result.map((r) => r.name)).toEqual(['alpha', 'zeta']);
  });

  it('returns an empty list when nothing is in scope anywhere', () => {
    expect(buildResolvedVars({}, null, null, [])).toEqual([]);
  });
});

describe('substituteVars', () => {
  it('replaces known tokens and leaves unknown ones visible', () => {
    expect(substituteVars('{{host}}/users/{{id}}', { host: 'https://api.test' }))
      .toBe('https://api.test/users/{{id}}');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteVars('{{ host }}', { host: 'x' })).toBe('x');
  });

  it('never resolves a name off Object.prototype', () => {
    // `name in vars` walked the prototype chain, so `{{constructor}}` was
    // substituted with the literal text `function Object() { [native code] }`
    // in the request that actually went out.
    expect(substituteVars('{{constructor}}', {})).toBe('{{constructor}}');
    expect(substituteVars('{{toString}}', { a: '1' })).toBe('{{toString}}');
    expect(substituteVars('{{__proto__}}', {})).toBe('{{__proto__}}');
  });

  it('substitutes an empty-string value rather than treating it as unknown', () => {
    expect(substituteVars('a{{x}}b', { x: '' })).toBe('ab');
  });
});
