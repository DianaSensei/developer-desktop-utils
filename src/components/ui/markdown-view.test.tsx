import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MarkdownView } from '@/components/ui/markdown-view';

afterEach(() => cleanup());

describe('MarkdownView', () => {
  it('opens links outside the app instead of navigating the webview', () => {
    const onOpenLink = vi.fn();
    render(<MarkdownView onOpenLink={onOpenLink}>{'[docs](https://example.com/x)'}</MarkdownView>);
    const link = screen.getByText('docs');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/x');
  });

  it('ignores non-web schemes', () => {
    const onOpenLink = vi.fn();
    render(<MarkdownView onOpenLink={onOpenLink}>{'[x](javascript:alert(1))'}</MarkdownView>);
    fireEvent.click(screen.getByText('x'));
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('renders GFM tables and task lists', () => {
    render(<MarkdownView>{'| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done'}</MarkdownView>);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  it('replaces CSP-blocked remote images with a labelled link chip', () => {
    render(<MarkdownView>{'![diagram](https://example.com/a.png)'}</MarkdownView>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('diagram').closest('a')?.getAttribute('href')).toBe('https://example.com/a.png');
  });
});
