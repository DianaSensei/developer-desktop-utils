import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOpenTools } from '@/hooks/useOpenTools';

describe('useOpenTools', () => {
  it('adds the active tool on mount and on each new visit, in visit order', () => {
    const { result, rerender } = renderHook(({ id }) => useOpenTools(id), {
      initialProps: { id: 'json-formatter' },
    });
    expect(result.current.openIds).toEqual(['json-formatter']);

    rerender({ id: 'uuid-generator' });
    expect(result.current.openIds).toEqual(['json-formatter', 'uuid-generator']);
  });

  it('revisiting an already-open tool does not reorder or duplicate it', () => {
    const { result, rerender } = renderHook(({ id }) => useOpenTools(id), {
      initialProps: { id: 'json-formatter' },
    });
    rerender({ id: 'uuid-generator' });
    rerender({ id: 'json-formatter' });
    expect(result.current.openIds).toEqual(['json-formatter', 'uuid-generator']);
  });

  it('excludes settings — visiting it never adds a tab', () => {
    const { result, rerender } = renderHook(({ id }) => useOpenTools(id), {
      initialProps: { id: 'settings' },
    });
    expect(result.current.openIds).toEqual([]);
    rerender({ id: 'json-formatter' });
    rerender({ id: 'settings' });
    expect(result.current.openIds).toEqual(['json-formatter']);
  });

  it('caps at 8 tabs, evicting the oldest first', () => {
    const { result, rerender } = renderHook(({ id }) => useOpenTools(id), {
      initialProps: { id: 'tool-0' },
    });
    for (let i = 1; i < 10; i++) rerender({ id: `tool-${i}` });
    expect(result.current.openIds).toHaveLength(8);
    expect(result.current.openIds).toEqual([
      'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', 'tool-7', 'tool-8', 'tool-9',
    ]);
  });

  it('closeTool removes a tab without touching the others', () => {
    const { result, rerender } = renderHook(({ id }) => useOpenTools(id), {
      initialProps: { id: 'json-formatter' },
    });
    rerender({ id: 'uuid-generator' });
    act(() => { result.current.closeTool('json-formatter'); });
    expect(result.current.openIds).toEqual(['uuid-generator']);
  });
});
