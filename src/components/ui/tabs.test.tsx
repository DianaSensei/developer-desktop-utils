// Covers the active tab's rounded-md pill — the app's one semantic shape for
// "this is selected" (design/RULES.md's "Bo góc cho 'đang chọn'" rule). This
// used to be an opt-in `variant` prop (a sliding-underline strip was the
// default); every consumer has since moved to the pill and the underline
// path was removed entirely, so there's only one shape to cover now.

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

describe('Tabs', () => {
  it('gives the active tab a filled rounded-md pill', () => {
    const { container } = render(<Tabs tabs={tabs} active="a" onSelect={() => {}} />);

    const [active] = visibleTabs(container);
    expect(active.textContent).toBe('Params');
    expect(active.className).toContain('rounded-md');
    expect(active.className).toContain('bg-card');
  });

  it('calls onSelect with the clicked tab\'s id', () => {
    const onSelect = vi.fn();
    const { container } = render(<Tabs tabs={tabs} active="a" onSelect={onSelect} />);
    const [, body] = visibleTabs(container);
    expect(body.textContent).toBe('Body');
    body.click();
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
