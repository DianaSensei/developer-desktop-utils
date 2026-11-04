import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SplitPane } from './split-pane';

function renderAtWidth(width: number, stackBelow?: number) {
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  render(<SplitPane direction="horizontal" stackBelow={stackBelow} first={<span>one</span>} second={<span>two</span>} />);
  spy.mockRestore();
  return screen.getByText('one').parentElement!.parentElement!;
}

afterEach(() => cleanup());

describe('SplitPane — responsive stacking', () => {
  it('keeps panes side by side when there is room', () => {
    expect(renderAtWidth(1000).className).toContain('flex-row');
  });

  it('stacks a side-by-side split narrower than stackBelow (default 560px)', () => {
    const root = renderAtWidth(420);
    expect(root.className).toContain('flex-col');
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('stackBelow={0} turns it off', () => {
    expect(renderAtWidth(420, 0).className).toContain('flex-row');
  });
});
