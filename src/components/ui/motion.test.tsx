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

describe('Vòng focus — MỘT công thức cho toàn app', () => {
  // Quét toàn bộ `src/**/*.tsx` thay vì một danh sách file cứng: sáu công thức
  // vòng focus khác nhau (`ring-acc/35`, `/40`, `/50`, đặc, có/không offset)
  // là đúng lỗi user report ở phiên trước — bị bắt lại một cách máy móc, không
  // phải liệt kê từng file rồi quên cập nhật danh sách lần sau.
  //
  // KHÔNG dùng cách đếm này để cấm `ring-*` nói chung — chấm trạng thái, viền
  // kéo-thả, khối màu trong Clockify… vẫn được dùng `ring-1`/`ring-2` với màu
  // ngữ nghĩa riêng (`ring-ok/40`, `ring-line`) vì đó không phải vòng focus.
  // Luật ở đây hẹp hơn: bất cứ đâu dùng ĐÚNG bề rộng `ring-[3px]` (bề rộng chỉ
  // dành riêng cho vòng focus trong app này) thì bắt buộc phải đi kèm màu
  // `ring-focus` trong CÙNG FILE.
  it('mọi `ring-[3px]` trong `src/**/*.tsx` đều có `ring-focus` đi kèm, trong cùng file', () => {
    const files = execSync(
      "git ls-files 'src/**/*.tsx' ':!:src/**/*.test.tsx'",
      { cwd: process.cwd(), encoding: 'utf-8' },
    ).trim().split('\n').filter(Boolean);

    const mismatches: string[] = [];
    for (const f of files) {
      const raw = readFileSync(resolve(process.cwd(), f), 'utf-8');
      // Bỏ comment trước khi đếm — cùng lý do `design-system/guard.test.ts`
      // làm việc này: một dòng giải thích *vì sao* nhắc tới `ring-[3px]` không
      // được tính là một lần dùng thật.
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
  // `focus:` khớp với MỌI kiểu nhận tiêu điểm, kể cả click chuột — nên vòng
  // sáng ở lại trên control cho tới khi bấm chỗ khác. `focus-visible:` chỉ khớp
  // khi trình duyệt đánh giá là người dùng đang đi bằng bàn phím. Trước đây
  // `SelectTrigger` (có mặt ở gần như mọi tool) và nút đóng Dialog dùng `focus:`.
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
      // `focus:` đứng một mình (không phải `focus-visible:` / `focus-within:`)
      // đi kèm ring/border/outline.
      expect(src, f).not.toMatch(/(?<!-)\bfocus:(ring|border|outline)/);
    }
  });

  // Bao quát bởi rào chắn tổng quát ở khối 'Vòng focus — MỘT công thức
  // cho toàn app' bên trên (Tailwind 4 không còn màu ring mặc định).

  it('nút không còn quầng sáng ngả accent — design/RULES.md cấm glow', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/ui/button.tsx'), 'utf-8');
    // Chỉ soi phần biến thể, không soi phần comment giải thích vì sao đã bỏ.
    const variants = src.slice(src.indexOf('variant: {'), src.indexOf('size: {'));
    expect(variants).not.toContain('shadow-primary');
    // Bóng chỉ đi qua thang của kit, không có utility nào ghi thẳng box-shadow.
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

describe('ContextMenu', () => {
  it('sống thêm một nhịp sau khi đóng để kịp thu lại — giống DropdownMenu', () => {
    vi.useFakeTimers();
    try {
      const state = { x: 50, y: 60, entries: [{ label: 'Xoá', onClick: vi.fn() }] };
      const onClose = vi.fn();
      render(<ContextMenu state={state} onClose={onClose} />);
      expect(screen.getByRole('menu')).toBeTruthy();

      fireEvent.click(screen.getByText('Xoá'));
      // Vẫn còn trong DOM ngay sau click — chưa gọi onClose thật.
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
