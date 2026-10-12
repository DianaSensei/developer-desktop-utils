import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { WorkspaceBar } from '@/components/WorkspaceBar';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { storageRemove } from '@/lib/persistentStore';

/**
 * Pure tab/workspace rules are tested in lib/workspaces.test.ts. These cover
 * the component: hiding when there is nothing to switch, navigation on tab
 * click, the close button, and ⌘/Ctrl+number shortcuts.
 */

function Where() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function Harness({ initialPath = '/json' }: { initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleProvider>
        <FeatureProvider>
          <WorkspaceProvider>
            <Link to="/json">To JSON</Link>
            <Link to="/unix-time">To Date</Link>
            <Where />
            <WorkspaceBar fallback={<span>identity</span>} />
          </WorkspaceProvider>
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

beforeEach(() => storageRemove('devtool-workspaces'));
afterEach(() => cleanup());

describe('WorkspaceBar', () => {
  it('shows the fallback with a single tab and one workspace', () => {
    render(<Harness />);
    expect(screen.getByText('identity')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('appears once a second tool is opened, and clicking a tab navigates back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    const jsonTab = tabs.find((t) => t.textContent?.includes('JSON'))!;
    fireEvent.click(jsonTab);
    expect(screen.getByTestId('path').textContent).toBe('/json');
    expect(jsonTab.getAttribute('aria-selected')).toBe('true');
  });

  it('closing the active tab moves to its neighbour', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    const dateTab = within(screen.getByRole('tablist'))
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true')!;
    fireEvent.click(within(dateTab).getByRole('button'));
    expect(screen.getByTestId('path').textContent).toBe('/json');
    // Back to one tab, one workspace → fallback again.
    expect(screen.getByText('identity')).toBeTruthy();
  });

  it('Ctrl/⌘+1 jumps to the first tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    expect(screen.getByTestId('path').textContent).toBe('/unix-time');
    // The real modifier depends on the platform; fire both, one matches.
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    expect(screen.getByTestId('path').textContent).toBe('/json');
  });

  it('switching to an emptied workspace seeds it with the tool on screen', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    // Workspace 2 via the menu → naming dialog → Enter (empty name is valid).
    fireEvent.click(screen.getByRole('button', { name: /workspace/i }));
    fireEvent.click(screen.getByText(/New workspace|Workspace mới/));
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    // Close workspace 2's only tab → empty.
    const only = within(screen.getByRole('tablist')).getByRole('tab');
    fireEvent.click(within(only).getByRole('button'));
    expect(within(screen.getByRole('tablist')).queryAllByRole('tab')).toHaveLength(0);
    // Switch to workspace 1 and back to 2 with ⌘/Ctrl+⌥+number.
    for (const n of ['1', '2']) {
      fireEvent.keyDown(window, { key: n, code: `Digit${n}`, ctrlKey: true, altKey: true });
      fireEvent.keyDown(window, { key: n, code: `Digit${n}`, metaKey: true, altKey: true });
    }
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('"Close other tabs" on a background tab navigates to the kept tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date')); // đang ở Date
    const jsonTab = within(screen.getByRole('tablist')).getAllByRole('tab').find((t) => t.textContent?.includes('JSON'))!;
    fireEvent.contextMenu(jsonTab);
    fireEvent.click(screen.getByText(/Close other tabs|Đóng các tab khác/));
    expect(screen.getByTestId('path').textContent).toBe('/json');
  });

  it('re-selecting the same tool after closing its last tab brings the tab back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    // A second workspace (seeded with the current tool) keeps the bar visible.
    fireEvent.click(screen.getByRole('button', { name: /workspace/i }));
    fireEvent.click(screen.getByText(/New workspace|Workspace mới/));
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    const only = within(screen.getByRole('tablist')).getByRole('tab');
    fireEvent.click(within(only).getByRole('button'));
    expect(within(screen.getByRole('tablist')).queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('path').textContent).toBe('/unix-time');
    // Pick the tool already on screen again: same pathname.
    fireEvent.click(screen.getByText('To Date'));
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(1);
  });

  it('tabs survive a remount (persisted, not session-only)', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    first.unmount();
    render(<Harness initialPath="/json" />);
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(2);
  });
});
