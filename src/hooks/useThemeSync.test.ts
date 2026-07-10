import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThemeSync } from './useThemeSync';

type Pref = 'light' | 'dark' | 'system';

function createMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    }),
  } as unknown as MediaQueryList;

  return {
    mql,
    setMatches(value: boolean) {
      matches = value;
      listeners.forEach((cb) => cb({ matches: value } as MediaQueryListEvent));
    },
  };
}

describe('useThemeSync', () => {
  let darkMock: ReturnType<typeof createMatchMediaMock>;
  const reducedMotionMql = {
    matches: true, // pretend reduced-motion is on so transition timers never fire in tests
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;

  function stubMatchMedia() {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) =>
        query.includes('prefers-reduced-motion') ? reducedMotionMql : darkMock.mql
      )
    );
  }

  beforeEach(() => {
    document.documentElement.classList.remove('dark', 'theme-transition');
    darkMock = createMatchMediaMock(false);
    stubMatchMedia();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves isDark=false for a fixed "light" preference and does not subscribe to OS changes', () => {
    const { result } = renderHook(() => useThemeSync('light'));
    expect(result.current).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(darkMock.mql.addEventListener).not.toHaveBeenCalled();
  });

  it('resolves isDark=true for a fixed "dark" preference', () => {
    const { result } = renderHook(() => useThemeSync('dark'));
    expect(result.current).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('resolves from the OS query and subscribes exactly once while preference is "system"', () => {
    darkMock = createMatchMediaMock(true);
    stubMatchMedia();

    const { result } = renderHook(() => useThemeSync('system'));
    expect(result.current).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(darkMock.mql.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('updates in real time when the OS theme changes while preference is "system"', () => {
    const { result } = renderHook(() => useThemeSync('system'));
    expect(result.current).toBe(false);

    act(() => {
      darkMock.setMatches(true);
    });

    expect(result.current).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes the OS listener when the preference moves away from "system"', () => {
    const { rerender } = renderHook(({ pref }: { pref: Pref }) => useThemeSync(pref), {
      initialProps: { pref: 'system' },
    });
    expect(darkMock.mql.addEventListener).toHaveBeenCalledTimes(1);

    rerender({ pref: 'light' });
    expect(darkMock.mql.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('removes the OS listener on unmount', () => {
    const { unmount } = renderHook(() => useThemeSync('system'));
    expect(darkMock.mql.addEventListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(darkMock.mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
