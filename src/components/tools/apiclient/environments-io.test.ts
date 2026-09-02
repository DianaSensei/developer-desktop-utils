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

  it('marks a secret-flagged variable as Postman\'s own "secret" type', () => {
    // Postman's UI masks a "secret"-typed value the same way this app's lock
    // icon does — carrying the flag across means the exported file, opened
    // in Postman or re-imported here, keeps the value protected either way.
    const withSecret = newEnvironment('S', null, [{ ...newKeyValue('apiKey', 'sk-live'), enabled: true, secret: true }]);
    const json = JSON.parse(exportEnvironmentPostman(withSecret));
    expect(json.values).toEqual([{ key: 'apiKey', value: 'sk-live', enabled: true, type: 'secret' }]);
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

  it('a secret lock survives an export/import round trip in either format', () => {
    // The lock gates masking in the UI, exclusion from generated code, and
    // History's redaction list (see KeyValueEditor's lock toggle) — losing it
    // on the way back in silently exposes a value the user deliberately
    // protected, with nothing in the UI saying it happened.
    const original = newEnvironment('S', null, [{ ...newKeyValue('apiKey', 'sk-live'), enabled: true, secret: true }]);
    expect(importEnvironment(exportEnvironmentNative(original)).variables[0].secret).toBe(true);
    expect(importEnvironment(exportEnvironmentPostman(original)).variables[0].secret).toBe(true);
    // And a variable that was never marked secret doesn't pick the flag up
    // from nowhere in either direction.
    const plain = newEnvironment('P', null, [newKeyValue('host', 'api.test')]);
    expect(importEnvironment(exportEnvironmentNative(plain)).variables[0].secret).toBeFalsy();
    expect(importEnvironment(exportEnvironmentPostman(plain)).variables[0].secret).toBeFalsy();
  });

  it('imports a hand-written Postman environment.json, marking a "secret"-typed value', () => {
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
    expect(imported.variables[0].secret).toBeFalsy();
    expect(imported.variables[1].secret).toBe(true);
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
