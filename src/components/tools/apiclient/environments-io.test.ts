import { describe, expect, it } from 'vitest';
import { exportEnvironmentNative, exportEnvironmentPostman, importEnvironment } from './environments-io';
import { newEnvironment, newKeyValue } from './types';

describe('environments-io — export', () => {
  const env = newEnvironment('Staging', 'coll-1', [
    { ...newKeyValue('host', 'staging.test'), enabled: true },
    { ...newKeyValue('disabledVar', 'x'), enabled: false },
  ]);

  it('exports the native format with variables intact', () => {
    const json = JSON.parse(exportEnvironmentNative(env));
    expect(json.__devtoolEnvironment).toBe(true);
    expect(json.name).toBe('Staging');
    expect(json.variables).toHaveLength(2);
    expect(json.variables[0]).toMatchObject({ key: 'host', value: 'staging.test', enabled: true });
  });

  it('exports the Postman environment format', () => {
    const json = JSON.parse(exportEnvironmentPostman(env));
    expect(json._postman_variable_scope).toBe('environment');
    expect(json.name).toBe('Staging');
    expect(json.values).toEqual([
      { key: 'host', value: 'staging.test', enabled: true, type: 'default' },
      { key: 'disabledVar', value: 'x', enabled: false, type: 'default' },
    ]);
  });
});

describe('environments-io — import', () => {
  it('round-trips its own native export', () => {
    const original = newEnvironment('Prod', 'coll-1', [{ ...newKeyValue('host', 'api.test'), enabled: true }]);
    const imported = importEnvironment(exportEnvironmentNative(original));
    expect(imported.name).toBe('Prod');
    expect(imported.variables).toEqual([expect.objectContaining({ key: 'host', value: 'api.test', enabled: true })]);
    // Never re-scoped to a collection on import — ids from the source file
    // can't be trusted to match anything in this workspace.
    expect(imported.collectionId).toBeNull();
    expect(imported.id).not.toBe(original.id);
  });

  it('round-trips its own Postman export', () => {
    const original = newEnvironment('QA', null, [{ ...newKeyValue('token', 's3cr3t'), enabled: false }]);
    const imported = importEnvironment(exportEnvironmentPostman(original));
    expect(imported.name).toBe('QA');
    expect(imported.variables).toEqual([expect.objectContaining({ key: 'token', value: 's3cr3t', enabled: false })]);
  });

  it('imports a hand-written Postman environment.json', () => {
    const text = JSON.stringify({
      id: 'abc-123',
      name: 'From Postman',
      values: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true, type: 'default' },
        { key: 'apiKey', value: 'k-1', enabled: false, type: 'secret' },
      ],
      _postman_variable_scope: 'environment',
    });
    const imported = importEnvironment(text);
    expect(imported.name).toBe('From Postman');
    expect(imported.collectionId).toBeNull();
    expect(imported.variables.map((v) => v.key)).toEqual(['baseUrl', 'apiKey']);
    expect(imported.variables[1].enabled).toBe(false);
  });

  it('drops rows with no key', () => {
    const text = JSON.stringify({ name: 'Sparse', values: [{ key: '', value: 'x' }, { key: 'ok', value: 'y' }] });
    const imported = importEnvironment(text);
    expect(imported.variables).toHaveLength(1);
    expect(imported.variables[0].key).toBe('ok');
  });

  it('rejects invalid JSON', () => {
    expect(() => importEnvironment('not json')).toThrow(/not valid JSON/);
  });

  it('rejects a file that is neither format', () => {
    expect(() => importEnvironment(JSON.stringify({ info: { name: 'A collection' }, item: [] })))
      .toThrow(/Not a recognized environment file/);
  });
});
