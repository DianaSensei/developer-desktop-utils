import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { WorkspaceBar } from '@/components/WorkspaceBar';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { storageRemove } from '@/lib/persistentStore';

/**
 * Quy tắc thuần (thêm/đóng/đẩy tab, tạo/xoá workspace) nằm ở
 * lib/workspaces.test.ts. File này phủ phần chỉ component mới có: ẩn mình khi
 * không có gì để chuyển, điều hướng khi bấm tab, nút × và phím tắt ⌘/Ctrl+số.
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
    // Phím mod thật phụ thuộc nền tảng — bắn cả hai, chỉ một khớp.
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    expect(screen.getByTestId('path').textContent).toBe('/json');
  });

  it('tabs survive a remount (persisted, not session-only)', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    first.unmount();
    render(<Harness initialPath="/json" />);
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(2);
  });
});
