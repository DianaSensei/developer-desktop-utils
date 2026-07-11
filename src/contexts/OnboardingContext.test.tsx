import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OnboardingProvider, useOnboarding } from './OnboardingContext';

const store = new Map<string, string>();
let fresh = true;

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (store.has(k) ? store.get(k)! : null),
  storageSet: (k: string, v: string) => { store.set(k, v); },
  wasFreshInstall: () => fresh,
}));

beforeEach(() => {
  store.clear();
  fresh = true;
});

describe('OnboardingProvider', () => {
  it('auto-shows onboarding for a brand-new install', () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper: OnboardingProvider });
    expect(result.current.show).toBe(true);
  });

  it('does not auto-show for an existing install, and marks it completed so it never does', () => {
    fresh = false;
    const { result } = renderHook(() => useOnboarding(), { wrapper: OnboardingProvider });
    expect(result.current.show).toBe(false);
    expect(store.get('devtool-onboarding-completed')).toBe('true');
  });

  it('close() hides the dialog, flips completed to true, and persists it', () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper: OnboardingProvider });
    expect(result.current.completed).toBe(false);
    act(() => result.current.close());
    expect(result.current.show).toBe(false);
    expect(result.current.completed).toBe(true);
    expect(store.get('devtool-onboarding-completed')).toBe('true');
  });

  it('open() re-shows the dialog even after it was already completed', () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper: OnboardingProvider });
    act(() => result.current.close());
    act(() => result.current.open());
    expect(result.current.show).toBe(true);
  });

  it('does not auto-show when devtool-onboarding-completed is already true from a prior run', () => {
    store.set('devtool-onboarding-completed', 'true');
    const { result } = renderHook(() => useOnboarding(), { wrapper: OnboardingProvider });
    expect(result.current.show).toBe(false);
  });
});
