import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { StatusMessage } from '@/components/StatusMessage';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * Rào chắn cho lớp chuyển động/phản hồi thao tác.
 *
 * Không kiểm "có chạy animation không" — jsdom không chạy animation, và kiểm
 * tên class thì chỉ chép lại đúng cái mình vừa viết. Kiểm những HÀNH VI mà một
 * lần refactor rất dễ làm hỏng lặng lẽ, và đúng những chỗ ĐÃ TỪNG hỏng lặng lẽ
 * trong repo này:
 *
 *   - class không tồn tại (Tailwind bỏ qua lặng lẽ, `StatusMessage` mất màu
 *     nhiều tháng mà không ai thấy),
 *   - phần tử bị gỡ khỏi DOM trước khi kịp có animation ra,
 *   - nội dung đang thu lại vẫn Tab vào được.
 */

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
    // `stroke-dasharray` phải khớp `--tick-len` mà keyframe kéo về 0; lệch nhau
    // thì nét vẽ hoặc bị cụt hoặc đứng im một đoạn đầu.
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
    // Còn trong DOM — nếu không thì không có gì để animate chiều cao.
    const inner = screen.getByText('Bên trong');
    // …nhưng `inert` để bàn phím và trình đọc màn hình bỏ qua phần đang cuộn lại.
    expect(inner.closest('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('Bên trong').closest('[inert]')).toBeNull();
  });
});

describe('StatusMessage', () => {
  it('mỗi trạng thái mang màu RIÊNG của nó', () => {
    // Đây chính là lỗi đã có thật: `success-state` / `error-state` /
    // `warning-state` không tồn tại ở đâu cả, nên Tailwind bỏ qua và báo lỗi
    // trông y hệt báo thành công. Test này khoá lại để không tái diễn.
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
      // Vẫn còn đó — nhưng đã ngừng nhận chuột, để cú click kế tiếp của người
      // dùng không rơi vào một panel đang biến mất.
      const menu = screen.getByRole('menu');
      expect(menu.className).toContain('pointer-events-none');

      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
