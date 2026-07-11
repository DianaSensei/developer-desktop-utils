import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const store = new Map<string, string>();
let fresh = true;
let versions: Record<string, number> = {};

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (store.has(k) ? store.get(k)! : null),
  storageSet: (k: string, v: string) => { store.set(k, v); },
  wasFreshInstall: () => fresh,
}));

vi.mock('@/lib/toolGuides', () => ({
  get TOOL_GUIDE_VERSIONS() { return versions; },
}));

vi.mock('@/lib/toolDefs', () => ({
  get TOOL_DEFS() { return [{ id: 'json' }, { id: 'regex' }]; },
}));

beforeEach(() => {
  store.clear();
  fresh = true;
  versions = { json: 1, regex: 1 };
});

describe('useToolGuideTracking', () => {
  it("auto-shows a tool's guide the first time it is opened on a fresh install", async () => {
    const { useToolGuideTracking } = await import('./useToolGuideTracking');
    const { result } = renderHook(() => useToolGuideTracking());
    expect(result.current.shouldAutoShow('json')).toBe(true);
  });

  it('stops auto-showing once markSeen has recorded the current version', async () => {
    const { useToolGuideTracking } = await import('./useToolGuideTracking');
    const { result } = renderHook(() => useToolGuideTracking());
    act(() => result.current.markSeen('json'));
    expect(result.current.shouldAutoShow('json')).toBe(false);
  });

  it('backfills every known tool as seen for an existing install, so an upgrade does not flood guides', async () => {
    fresh = false;
    const { useToolGuideTracking } = await import('./useToolGuideTracking');
    const { result } = renderHook(() => useToolGuideTracking());
    expect(result.current.shouldAutoShow('json')).toBe(false);
    expect(result.current.shouldAutoShow('regex')).toBe(false);
  });

  it('auto-shows again after a tool guide version bump, even for an existing install', async () => {
    fresh = false;
    store.set('devtool-guide-seen-versions', JSON.stringify({ json: 1, regex: 1 }));
    versions = { json: 2, regex: 1 };
    const { useToolGuideTracking } = await import('./useToolGuideTracking');
    const { result } = renderHook(() => useToolGuideTracking());
    expect(result.current.shouldAutoShow('json')).toBe(true);
    expect(result.current.shouldAutoShow('regex')).toBe(false);
  });
});
