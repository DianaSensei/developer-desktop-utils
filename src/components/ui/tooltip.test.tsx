import { describe, expect, it, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Tooltips are the only labels in the collapsed sidebar. They must open on
 * keyboard focus, not just hover, and stay inside the viewport.
 */

function stubRect(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}), ...rect,
  }) as DOMRect;
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
});

afterEach(cleanup);

describe('Tooltip', () => {
  it('hiện khi trigger nhận focus, ẩn khi mất focus', () => {
    render(<Tooltip label="Cron Generator" delay={0}><button>open</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'open' });

    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { fireEvent.focus(trigger); });
    expect(screen.getByRole('tooltip').textContent).toContain('Cron Generator');
    act(() => { fireEvent.blur(trigger); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Escape đóng tooltip đang mở bằng bàn phím', () => {
    render(<Tooltip label="Settings" delay={0}><button>open</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'open' });
    act(() => { fireEvent.focus(trigger); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => { fireEvent.keyDown(trigger, { key: 'Escape' }); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('không tràn ra ngoài viewport khi trigger nằm sát mép', () => {
    const { container } = render(
      <Tooltip label="Redis" side="right" delay={0}><button>open</button></Tooltip>,
    );
    // Trigger at the bottom-right corner; unclamped it would sit at ≈1000/695.
    stubRect(container.firstElementChild!, { top: 690, bottom: 700, left: 980, right: 995, width: 15, height: 10 });

    act(() => { fireEvent.focus(screen.getByRole('button', { name: 'open' })); });
    const bubble = screen.getByRole('tooltip') as HTMLElement;
    const left = parseFloat(bubble.style.left);
    const top = parseFloat(bubble.style.top);

    expect(left + 208).toBeLessThanOrEqual(1000); // 208px = maxWidth 13rem
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(700);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});
