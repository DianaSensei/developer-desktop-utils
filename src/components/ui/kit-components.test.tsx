import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusChip } from '@/components/ui/status-chip';
import { OutlineNotice } from '@/components/ui/outline-notice';
import { ExplainBand } from '@/components/ui/explain-band';
import { ParamRow } from '@/components/ui/param-row';
import { SettingRow } from '@/components/ui/setting-row';
import { FieldShell } from '@/components/ui/field-shell';
import { Keycap } from '@/components/ui/keycap';
import { Button } from '@/components/ui/button';

/**
 * Test cho các component dựng ở G2.
 *
 * Không kiểm "có render không" — cái đó build đã bắt. Kiểm những HÀNH VI mà một
 * lần refactor vô tình rất dễ làm hỏng mà không ai thấy: vai trò ARIA của lỗi,
 * ranh giới bấm được của dòng cấu hình, và luật màu trạng thái.
 */

describe('StatusChip', () => {
  it('gắn màu theo tông, không theo accent', () => {
    const { container, rerender } = render(<StatusChip tone="ok">Hợp lệ</StatusChip>);
    const cls = () => (container.firstChild as HTMLElement).className;
    expect(cls()).toContain('text-ok');

    rerender(<StatusChip tone="bad">Lỗi</StatusChip>);
    expect(cls()).toContain('text-bad');

    // Không tông nào được rơi vào lớp accent — đó là điều kiện để đổi tone chủ
    // đạo mà chip trạng thái giữ nguyên màu.
    for (const tone of ['ok', 'warn', 'bad', 'info'] as const) {
      rerender(<StatusChip tone={tone}>x</StatusChip>);
      expect((container.firstChild as HTMLElement).className).not.toMatch(/\bt(ext|ex)-acc|bg-acc/);
    }
  });

  it('ẩn được chấm tròn khi đã có icon riêng', () => {
    const { container, rerender } = render(<StatusChip tone="ok">A</StatusChip>);
    const pips = () => container.querySelectorAll('span.rounded-full.h-1\\.5');
    expect(pips()).toHaveLength(1);
    rerender(<StatusChip tone="ok" hidePip>A</StatusChip>);
    expect(pips()).toHaveLength(0);
  });
});

describe('ExplainBand', () => {
  it('báo lỗi bằng role="alert", các tông khác chỉ là "status"', () => {
    // Lỗi phải được trình đọc màn hình đọc ngay; "hợp lệ" thì không nên cắt lời.
    const { rerender } = render(<ExplainBand tone="bad">Sai cú pháp</ExplainBand>);
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(<ExplainBand tone="ok">Đúng rồi</ExplainBand>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('chip ví dụ bấm được, và chỉ khi có onPick', () => {
    const pick = vi.fn();
    render(
      <ExplainBand
        tone="bad"
        examples={[{ label: '*/5 * * * *', onPick: pick }, { label: 'chỉ để đọc' }]}
      >
        Sai
      </ExplainBand>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('luôn hiện câu giải thích — không giấu sau tương tác', () => {
    render(<ExplainBand tone="warn" title="Sắp hết hạn">Chứng chỉ còn 3 ngày.</ExplainBand>);
    expect(screen.getByText(/Chứng chỉ còn 3 ngày/)).toBeTruthy();
  });
});

describe('OutlineNotice', () => {
  it('không có nền — chỉ viền', () => {
    const { container } = render(<OutlineNotice tone="warn">Đang chờ</OutlineNotice>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('border-warn-edge');
  });
});

describe('ParamRow', () => {
  it('giá trị dùng tabular-nums để cột số thẳng hàng', () => {
    render(<ParamRow label="Poll interval" value="500ms">Bao lâu hỏi một lần</ParamRow>);
    expect(screen.getByText('500ms').className).toContain('tabular-nums');
  });

  it('chỉ hiện nút trợ giúp khi có nội dung help', () => {
    const { rerender } = render(<ParamRow label="A" value="1" />);
    expect(screen.queryByLabelText('Giải thích thêm')).toBeNull();
    rerender(<ParamRow label="A" value="1" help="Sâu hơn" />);
    expect(screen.getByLabelText('Giải thích thêm')).toBeTruthy();
  });
});

describe('SettingRow', () => {
  it('chỉ thành nút khi có onOpen', () => {
    const { rerender } = render(<SettingRow title="Múi giờ" control={<span>UTC</span>} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<SettingRow title="Khoá" onOpen={() => {}} />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('disabled thì không bấm được', () => {
    const open = vi.fn();
    render(<SettingRow title="Khoá" onOpen={open} disabled />);
    // Dòng bị vô hiệu không được dựng thành nút, nếu không bàn phím vẫn tới được.
    expect(screen.queryByRole('button')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('FieldShell', () => {
  it('dựng đủ máng, chỉ số và chip', () => {
    render(
      <FieldShell gutter="JSON" meter="128" chips={<span>gợi ý</span>}>
        <input aria-label="nội dung" />
      </FieldShell>,
    );
    expect(screen.getByText('JSON')).toBeTruthy();
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('gợi ý')).toBeTruthy();
  });

  it('viền đổi theo tông trạng thái', () => {
    const { container } = render(
      <FieldShell tone="bad"><input aria-label="x" /></FieldShell>,
    );
    expect((container.firstChild!.firstChild as HTMLElement).className).toContain('border-bad-edge');
  });
});

describe('Button + Keycap', () => {
  it('sc hiện phím tắt nội tuyến trong nút', () => {
    render(<Button sc="⏎">Chạy</Button>);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('Chạy⏎');
  });

  it('không chèn phím tắt khi asChild — nút chỉ là lớp bọc', () => {
    render(<Button asChild sc="⏎"><a href="#x">Mở</a></Button>);
    expect(screen.getByRole('link').textContent).toBe('Mở');
  });

  it('biến thể tint dùng nền nhuộm của accent', () => {
    render(<Button variant="tint">Định dạng lại</Button>);
    expect(screen.getByRole('button').className).toContain('bg-acc-tint');
  });

  it('Keycap mod chèn phím lệnh của hệ điều hành', () => {
    render(<Keycap mod>K</Keycap>);
    // Chạy trên jsdom (không phải Mac) nên là Ctrl+K; trên macOS sẽ là ⌘K.
    expect(screen.getByText(/K$/).textContent).toMatch(/^(⌘K|Ctrl\+K)$/);
  });
});
