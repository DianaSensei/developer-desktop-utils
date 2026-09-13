// Covers the 'pill' variant added for API Client's request-panel tab bar
// (Params/Body/Auth/…) — a Postman-style rounded active pill instead of the
// sliding-underline bar every other consumer (Kafka, RabbitMQ, the default)
// still uses. The default variant's own behavior is exercised implicitly by
// every existing consumer; this file only covers the opt-in difference.
//
// Queried via `[aria-selected]`, not `getByText` — the component also
// renders a hidden, `aria-hidden` measuring row with the same label text
// purely to compute intrinsic tab widths, so a plain text query matches two
// buttons.

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Tabs } from './tabs';

const tabs = [
  { id: 'a', label: 'Params' },
  { id: 'b', label: 'Body' },
];

function visibleTabs(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-selected]'));
}

describe('Tabs — variant="pill"', () => {
  it('gives the active tab a filled pill instead of the sliding underline bar', () => {
    const { container } = render(
      <Tabs tabs={tabs} active="a" onSelect={() => {}} variant="pill" />,
    );

    const [active] = visibleTabs(container);
    expect(active.textContent).toBe('Params');
    expect(active.className).toContain('rounded-md');
    expect(active.className).toContain('bg-card');
    expect(active.className).not.toContain('border-b-2');

    // The underline variant's sliding bar (aria-hidden span with bg-acc) must
    // not be rendered in pill mode — there's nothing for it to slide under.
    const bar = container.querySelector('[aria-hidden="true"].bg-acc');
    expect(bar).toBeNull();
  });

  it('leaves the default (underline) variant unchanged for every other consumer', () => {
    const { container } = render(<Tabs tabs={tabs} active="a" onSelect={() => {}} />);
    const [active] = visibleTabs(container);
    expect(active.className).toContain('border-b-2');
    expect(active.className).not.toContain('rounded-md');
  });

  it('still calls onSelect with the clicked tab\'s id in pill mode', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Tabs tabs={tabs} active="a" onSelect={onSelect} variant="pill" />,
    );
    const [, body] = visibleTabs(container);
    expect(body.textContent).toBe('Body');
    body.click();
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
