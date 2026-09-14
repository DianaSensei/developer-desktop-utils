// Regression coverage for the Environments dialog's precedence explainer:
// it used to always render its full ~3-line paragraph, permanently pushing
// the actual environment list/table down even for a returning user who'd
// already read it. It's now collapsed to a one-line summary by default, with
// a "Learn more" toggle to expand the full text on demand.

import { act, renderHook, render, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentEditor } from './EnvironmentEditor';

const cache = new Map<string, string>();

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (cache.has(k) ? cache.get(k)! : null),
  storageSet: (k: string, v: string) => { cache.set(k, v); },
  flushPersistentStore: () => Promise.resolve(),
}));

beforeEach(() => {
  cache.clear();
});

describe('EnvironmentEditor — precedence explainer collapse', () => {
  it('shows only the one-line precedence summary until "Learn more" is clicked', async () => {
    const { useApiStore } = await import('./store');
    const { result } = renderHook(() => useApiStore());

    const { getByText, queryByText } = render(
      <EnvironmentEditor store={result.current} open onClose={() => {}} />,
    );

    // The full paragraph's distinguishing sentence is absent until expanded.
    expect(queryByText(/scoped to one/)).toBeNull();
    expect(getByText(/Precedence:/)).toBeTruthy();

    fireEvent.click(getByText('Learn more'));

    expect(getByText(/scoped to one/)).toBeTruthy();
    expect(queryByText(/Precedence:/)).toBeNull();

    fireEvent.click(getByText('Show less'));
    act(() => {});
    expect(queryByText(/scoped to one/)).toBeNull();
    expect(getByText(/Precedence:/)).toBeTruthy();
  });
});
