import { beforeEach, describe, expect, it } from 'vitest';
import { storageGet, storageKeys, storageRemove, storageSet } from '@/lib/persistentStore';
import {
  NOTICE_KEY, UNDO_KEY, buildExport, exportFileName, importConfig, parseConfigFile, readToolData, readUndo,
  resetToolData, serializeConfig, summarizeFile, takeNotice, toolsWithData, undoLastImport, type ConfigFile,
} from './configTransfer';

function clear() {
  for (const k of storageKeys()) storageRemove(k);
}

beforeEach(() => {
  clear();
  storageSet('devtool:api-client:collections', '[{"name":"Users"}]');
  storageSet('devtool:api-client:history', '[]');
  storageSet('devtool:json:indent', '2');
  storageSet('devtool-theme', 'dark');
  storageSet('devtool-locale', 'vi');
  storageSet('devtool-last-update-check', '123');
  storageSet('devtool-pending-update', '{"v":"9"}');
});

const NOW = new Date('2026-11-05T10:00:00Z');

describe('export', () => {
  it('collects tool namespaces and app keys, skipping per-machine keys', () => {
    const file = buildExport({ toolIds: ['api-client', 'json'], includeApp: true, appVersion: '1.7.0', now: NOW });
    expect(file).toMatchObject({ format: 'devtool-config', version: 1, exportedAt: NOW.toISOString(), appVersion: '1.7.0' });
    expect(file.tools).toEqual({
      'api-client': { collections: '[{"name":"Users"}]', history: '[]' },
      json: { indent: '2' },
    });
    expect(file.app).toEqual({ 'devtool-theme': 'dark', 'devtool-locale': 'vi' });
  });

  it('leaves app settings out of a tool export and names the file after the tool', () => {
    const file = buildExport({ toolIds: ['json'], includeApp: false, now: NOW });
    expect(file.app).toBeUndefined();
    expect(exportFileName(['json'], false, NOW)).toBe('devtool-json-config-2026-11-05.json');
    expect(exportFileName(['json', 'api-client'], true, NOW)).toBe('devtool-config-2026-11-05.json');
  });

  it('lists tools with data, largest first', () => {
    expect(toolsWithData().map((t) => [t.id, t.keys])).toEqual([['api-client', 2], ['json', 1]]);
  });

  it('round-trips through the file format', () => {
    const file = buildExport({ toolIds: ['api-client'], includeApp: true, now: NOW });
    const parsed = parseConfigFile(serializeConfig(file));
    expect(parsed).toEqual({ ok: true, file });
  });
});

describe('parse', () => {
  it('rejects what is not a DevTool settings file', () => {
    expect(parseConfigFile('nope')).toEqual({ ok: false, error: 'notJson' });
    expect(parseConfigFile('{"a":1}')).toEqual({ ok: false, error: 'wrongFormat' });
    expect(parseConfigFile('{"format":"devtool-config","version":99,"tools":{}}')).toEqual({ ok: false, error: 'newerVersion' });
    expect(parseConfigFile('{"format":"devtool-config","version":1,"tools":{}}')).toEqual({ ok: false, error: 'empty' });
  });

  it('drops anything that is not a string value under a valid id or app key', () => {
    const parsed = parseConfigFile(JSON.stringify({
      format: 'devtool-config',
      version: 1,
      tools: { json: { indent: '4', bad: 5 }, '../evil': { x: 'y' }, empty: {} },
      app: { 'devtool-theme': 'light', 'devtool-pending-update': 'x', other: 'y', 'devtool-config-undo': 'z' },
    }));
    expect(parsed.ok && parsed.file.tools).toEqual({ json: { indent: '4' } });
    expect(parsed.ok && parsed.file.app).toEqual({ 'devtool-theme': 'light' });
    expect(parsed.ok && summarizeFile(parsed.file).map((t) => t.id)).toEqual(['json']);
  });
});

describe('import', () => {
  const file: ConfigFile = {
    format: 'devtool-config',
    version: 1,
    exportedAt: '',
    tools: { 'api-client': { collections: '[]' }, json: { indent: '4', sort: 'true' } },
    app: { 'devtool-theme': 'light' },
  };

  it('replace: the tool ends up with exactly the file\'s keys', () => {
    const changed = importConfig(file, { toolIds: ['api-client'], includeApp: false, mode: 'replace', label: 'API Client', now: NOW });
    expect(readToolData('api-client')).toEqual({ collections: '[]' });
    expect(readToolData('json')).toEqual({ indent: '2' }); // not chosen, untouched
    expect(storageGet('devtool-theme')).toBe('dark');
    expect(changed).toBe(2); // collections changed, history removed
  });

  it('merge: overwrites only the file\'s keys', () => {
    importConfig(file, { toolIds: ['api-client', 'json'], includeApp: true, mode: 'merge', label: 'all', now: NOW });
    expect(readToolData('api-client')).toEqual({ collections: '[]', history: '[]' });
    expect(readToolData('json')).toEqual({ indent: '4', sort: 'true' });
    expect(storageGet('devtool-theme')).toBe('light');
  });

  it('undo puts back exactly what the import replaced', () => {
    const before = Object.fromEntries(storageKeys().map((k) => [k, storageGet(k)]));
    importConfig(file, { toolIds: ['api-client', 'json'], includeApp: true, mode: 'replace', label: 'all', now: NOW });
    expect(readUndo()).toMatchObject({ label: 'all', at: NOW.toISOString() });
    undoLastImport();
    const after = Object.fromEntries(storageKeys().map((k) => [k, storageGet(k)]));
    expect(after).toEqual(before);
    expect(storageGet(UNDO_KEY)).toBeNull();
  });

  it('reset clears one tool and is undoable', () => {
    resetToolData('api-client', 'reset API Client', NOW);
    expect(readToolData('api-client')).toEqual({});
    undoLastImport();
    expect(readToolData('api-client')).toEqual({ collections: '[{"name":"Users"}]', history: '[]' });
  });
});

describe('notice', () => {
  it('is read once', () => {
    storageSet(NOTICE_KEY, JSON.stringify({ kind: 'import', label: 'JSON', changed: 3 }));
    expect(takeNotice()).toEqual({ kind: 'import', label: 'JSON', changed: 3 });
    expect(takeNotice()).toBeNull();
  });
});
