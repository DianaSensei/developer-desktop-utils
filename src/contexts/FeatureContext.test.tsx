import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FeatureProvider, useFeatures } from './FeatureContext';

const TOOL_ORDER_KEY = 'devtool-tool-order';
const store = new Map<string, string>();

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (store.has(k) ? store.get(k)! : null),
  storageSet: (k: string, v: string) => { store.set(k, v); },
}));

beforeEach(() => {
  store.clear();
});

describe('FeatureProvider', () => {
  it('throws when useFeatures is used outside a provider', () => {
    expect(() => renderHook(() => useFeatures())).toThrow(
      'useFeatures must be used within a FeatureProvider'
    );
  });

  it('defaults task-tracker on and color-picker off', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.isFeatureEnabled('task-tracker')).toBe(true);
    expect(result.current.isFeatureEnabled('color-picker')).toBe(false);
  });

  it('treats an unknown feature id as enabled', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.isFeatureEnabled('some-future-tool')).toBe(true);
  });

  it('toggleFeature flips a feature and persists it', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    act(() => result.current.toggleFeature('color-picker'));
    expect(result.current.isFeatureEnabled('color-picker')).toBe(true);
    expect(JSON.parse(store.get('devtool-features')!)['color-picker']).toBe(true);
  });

  it('merges saved overrides onto defaults, keeping new tools at their default value', () => {
    store.set('devtool-features', JSON.stringify({ 'color-picker': true }));
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.isFeatureEnabled('color-picker')).toBe(true);
    expect(result.current.isFeatureEnabled('task-tracker')).toBe(true);
  });

  it('falls back to defaults when the saved value is corrupt JSON', () => {
    store.set('devtool-features', '{not json');
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.isFeatureEnabled('task-tracker')).toBe(true);
  });

  it('resetToDefaults restores the default feature map', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    act(() => result.current.toggleFeature('color-picker'));
    act(() => result.current.resetToDefaults());
    expect(result.current.isFeatureEnabled('color-picker')).toBe(false);
  });

  it('reorderTools updates order and persists it', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    act(() => result.current.reorderTools(['json', 'base64']));
    expect(result.current.toolOrder).toEqual(['json', 'base64']);
    expect(JSON.parse(store.get('devtool-tool-order')!)).toEqual(['json', 'base64']);
  });

  it('loads a saved tool order, defaulting to empty when nothing is saved', () => {
    const empty = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(empty.result.current.toolOrder).toEqual([]);

    store.set('devtool-tool-order', JSON.stringify(['jwt', 'regex']));
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.toolOrder).toEqual(['jwt', 'regex']);
  });

  it('falls back to empty tool order when the saved value is corrupt JSON', () => {
    store.set(TOOL_ORDER_KEY, '{not json');
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.toolOrder).toEqual([]);
  });

  it('toggleFavorite adds a favorite to the front and persists it', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    act(() => result.current.toggleFavorite('json'));
    act(() => result.current.toggleFavorite('base64'));
    expect(result.current.favorites).toEqual(['base64', 'json']);
    expect(result.current.isFavorite('json')).toBe(true);
    expect(JSON.parse(store.get('devtool-favorites')!)).toEqual(['base64', 'json']);
  });

  it('toggleFavorite removes an existing favorite', () => {
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    act(() => result.current.toggleFavorite('json'));
    act(() => result.current.toggleFavorite('json'));
    expect(result.current.favorites).toEqual([]);
    expect(result.current.isFavorite('json')).toBe(false);
  });

  it('loads saved favorites, defaulting to empty when nothing is saved or JSON is corrupt', () => {
    const empty = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(empty.result.current.favorites).toEqual([]);

    store.set('devtool-favorites', '{not json');
    const { result } = renderHook(() => useFeatures(), { wrapper: FeatureProvider });
    expect(result.current.favorites).toEqual([]);
  });
});
