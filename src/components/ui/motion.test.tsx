import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { StatusMessage } from '@/components/StatusMessage';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * Guards for motion and interaction feedback. jsdom does not run animations,
 * so these check behaviors that refactors break silently: class names that
 * do not exist (Tailwind ignores them), elements removed before their exit
 * animation, and collapsed content that is still focusable.
 */

describe('Vòng focus — MỘT công thức cho toàn app', () => {
  // Scans every `src/**/*.tsx`: any use of `ring-[3px]` (the focus ring
  // width) must come with `ring-focus` in the same file. Other `ring-*`
  // uses (status dots, drag outlines) are not focus rings and are allowed.
  it('mọi `ring-[3px]` trong `src/**/*.tsx` đều có `ring-focus` đi kèm, trong cùng file', () => {
    const files = execSync(
      "git ls-files 'src/**/*.tsx' ':!:src/**/*.test.tsx'",
      { cwd: process.cwd(), encoding: 'utf-8' },
    ).trim().split('\n').filter(Boolean);

    const mismatches: string[] = [];
    for (const f of files) {
      const raw = readFileSync(resolve(process.cwd(), f), 'utf-8');
      // Strip comments first, so text explaining `ring-[3px]` is not counted.
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const widths = stripped.match(/ring-\[3px\]/g)?.length ?? 0;
      const colors = stripped.match(/ring-focus\b/g)?.length ?? 0;
      if (widths !== colors) mismatches.push(`${f}: ${widths} ring-[3px] vs ${colors} ring-focus`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('Vòng focus — không được dính lại sau khi bấm chuột', () => {
  // `focus:` also matches mouse focus, leaving the ring after a click;
  // `focus-visible:` only applies to keyboard navigation.
  const files = [
    'src/components/ui/select.tsx',
    'src/components/ui/dialog.tsx',
    'src/components/ui/input.tsx',
    'src/components/ui/textarea.tsx',
    'src/components/ui/button.tsx',
  ];

  it('không control dùng chung nào còn dùng `focus:` cho vòng sáng', () => {
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf-8');
      // Bare `focus:` (not `focus-visible:`/`focus-within:`) with ring,
      // border or outline.
      expect(src, f).not.toMatch(/(?<!-)\bfocus:(ring|border|outline)/);
    }
  });

  // Covered by the app-wide focus ring guard above.

  it('nút không còn quầng sáng ngả accent — design/RULES.md cấm glow', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/ui/button.tsx'), 'utf-8');
    // Check the variants only, not the comments.
    const variants = src.slice(src.indexOf('variant: {'), src.indexOf('size: {'));
    expect(variants).not.toContain('shadow-primary');
    // Shadows only come from the kit scale; no arbitrary box-shadow.
    expect(variants).not.toMatch(/shadow-\[/);
  });
});

describe('Checkbox', () => {
  it('báo đúng trạng thái cho trình đọc màn hình, kể cả "một phần"', () => {
    const { rerender } = render(<Checkbox checked={false} />);
    expect(screen.getByRole('checkbox')).toHaveProperty('ariaChecked', 'false');

    rerender(<Checkbox checked />);
    expect(screen.getByRole('checkbox')).toHaveProperty('ariaChecked', 'true');

    rerender(<Checkbox checked={false} indeterminate />);
    expect(screen.getByRole('checkbox')).toHaveProperty('ariaChecked', 'mixed');
  });

  it('nét tick chỉ vẽ khi bật, và dài đúng bằng path của nó', () => {
    const { container, rerender } = render(<Checkbox checked={false} />);
    expect(container.querySelector('path')).toBeNull();

    rerender(<Checkbox checked />);
    const tick = container.querySelector('path')!;
    // `stroke-dasharray` must match `--tick-len`, which the keyframe
    // animates to 0.
    expect(tick.getAttribute('stroke-dasharray')).toBe('16');

    rerender(<Checkbox checked={false} indeterminate />);
    expect(container.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('8');
  });

  it('đảo giá trị khi bấm', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('busy — nút đang chạy', () => {
  it('khoá nút và báo aria-busy, để không bấm được lượt thứ hai', () => {
    render(<Button busy>Refresh</Button>);
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('không đụng gì tới nút bình thường', () => {
    render(<Button>Refresh</Button>);
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('`disabled` do call site đặt vẫn thắng', () => {
    render(<IconButton busy={false} disabled title="x" />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });
});

describe('CollapsibleSection', () => {
  it('giữ nội dung trong DOM để thu lại được, nhưng chặn Tab vào khi đang đóng', () => {
    render(
      <CollapsibleSection title="Advanced" defaultOpen={false}>
        <button>Bên trong</button>
      </CollapsibleSection>,
    );
    // Still in the DOM, so its height can animate...
    const inner = screen.getByText('Bên trong');
    // ...but `inert`, so keyboard and screen readers skip it.
    expect(inner.closest('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Bên trong').closest('[inert]')).toBeNull();
  });
});

describe('StatusMessage', () => {
  it('mỗi trạng thái mang màu RIÊNG của nó', () => {
    // These class names once did not exist, so every state looked the same.
    const tones = { success: 'text-ok', error: 'text-bad', warning: 'text-warn', info: 'text-info' } as const;
    for (const [status, expected] of Object.entries(tones)) {
      const { container, unmount } = render(
        <StatusMessage status={status as keyof typeof tones} message="x" />,
      );
      expect((container.firstChild as HTMLElement).className).toContain(expected);
      unmount();
    }
  });
});

describe('ContextMenu', () => {
  it('sống thêm một nhịp sau khi đóng để kịp thu lại — giống DropdownMenu', () => {
    vi.useFakeTimers();
    try {
      const state = { x: 50, y: 60, entries: [{ label: 'Xoá', onClick: vi.fn() }] };
      const onClose = vi.fn();
      render(<ContextMenu state={state} onClose={onClose} />);
      expect(screen.getByRole('menu')).toBeTruthy();

      fireEvent.click(screen.getByText('Xoá'));
      // Still in the DOM right after the click; onClose has not run yet.
      const menu = screen.getByRole('menu');
      expect(menu.className).toContain('pointer-events-none');
      expect(onClose).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(130); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DropdownMenu', () => {
  it('sống thêm một nhịp sau khi đóng để kịp thu lại, rồi mới bị gỡ', () => {
    vi.useFakeTimers();
    try {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Mở</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Một</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      fireEvent.click(screen.getByText('Mở'));
      expect(screen.getByRole('menu')).toBeTruthy();

      fireEvent.click(screen.getByText('Mở'));
      // Still present but no longer receives clicks while it disappears.
      const menu = screen.getByRole('menu');
      expect(menu.className).toContain('pointer-events-none');

      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
