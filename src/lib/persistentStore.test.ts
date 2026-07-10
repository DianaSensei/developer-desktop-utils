import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for a `@tauri-apps/plugin-store` Store instance, backed
// by whatever `fakeStoreData` the test sets before calling
// `initPersistentStore()`. Mirrors just the subset of the real Store API
// persistentStore.ts actually uses.
class FakeStore {
  data: Map<string, unknown>;
  constructor(initial: Record<string, unknown> = {}) {
    this.data = new Map(Object.entries(initial));
  }
  async get(key: string) {
    return this.data.has(key) ? this.data.get(key) : undefined;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async save() {}
  async clear() {
    this.data.clear();
  }
  async entries() {
    return Array.from(this.data.entries());
  }
}

let fakeStoreData: Record<string, unknown> = {};

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => new FakeStore(fakeStoreData)),
}));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  fakeStoreData = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setThemePreference / getThemePreference', () => {
  it('defaults to "system" when nothing has ever been stored', async () => {
    const mod = await import('./persistentStore');
    expect(mod.getThemePreference()).toBe('system');
  });

  it('round-trips a valid value and mirrors it into the shadow localStorage key', async () => {
    const mod = await import('./persistentStore');
    mod.setThemePreference('dark');
    expect(mod.getThemePreference()).toBe('dark');
    expect(localStorage.getItem('devtool-theme-shadow')).toBe('dark');

    mod.setThemePreference('light');
    expect(mod.getThemePreference()).toBe('light');
    expect(localStorage.getItem('devtool-theme-shadow')).toBe('light');
  });

  it('throws on a value outside the enum', async () => {
    const mod = await import('./persistentStore');
    expect(() => mod.setThemePreference('blue' as unknown as 'light')).toThrow();
  });

  it('self-heals a corrupted stored value back to "system"', async () => {
    const mod = await import('./persistentStore');
    // Simulate a corrupted store value written outside the wrapper (e.g. a
    // future schema change gone wrong) by poking the cache directly.
    mod.storageSet('devtool-theme', 'not-a-real-theme');

    expect(mod.getThemePreference()).toBe('system');
    // Self-heal must persist, not just paper over the read.
    expect(mod.storageGet('devtool-theme')).toBe('system');
    expect(localStorage.getItem('devtool-theme-shadow')).toBe('system');
  });
});

describe('devtool-dark-mode -> devtool-theme migration (initPersistentStore)', () => {
  it('maps devtool-dark-mode="true" to "dark" and removes the old key', async () => {
    fakeStoreData = { 'devtool-dark-mode': 'true' };
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    expect(mod.getThemePreference()).toBe('dark');
    expect(mod.storageGet('devtool-dark-mode')).toBeNull();
  });

  it('maps devtool-dark-mode="false" to "light"', async () => {
    fakeStoreData = { 'devtool-dark-mode': 'false' };
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    expect(mod.getThemePreference()).toBe('light');
  });

  it('maps a missing devtool-dark-mode key to "system"', async () => {
    fakeStoreData = {};
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    expect(mod.getThemePreference()).toBe('system');
  });

  it('maps a corrupt devtool-dark-mode value to "system"', async () => {
    fakeStoreData = { 'devtool-dark-mode': 'yes-please' };
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    expect(mod.getThemePreference()).toBe('system');
  });

  it('does not overwrite an already-valid devtool-theme value', async () => {
    fakeStoreData = { 'devtool-dark-mode': 'true', 'devtool-theme': 'light' };
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    expect(mod.getThemePreference()).toBe('light');
  });

  it('is a no-op once __migratedThemeKey_v1 has already been set', async () => {
    fakeStoreData = {
      'devtool-dark-mode': 'true',
      __migratedThemeKey_v1: true,
    };
    const mod = await import('./persistentStore');
    await mod.initPersistentStore();

    // Migration skipped entirely: old key untouched, new key never written
    // (falls back to the default via self-heal on read).
    expect(mod.storageGet('devtool-dark-mode')).toBe('true');
    expect(mod.getThemePreference()).toBe('system');
  });
});
