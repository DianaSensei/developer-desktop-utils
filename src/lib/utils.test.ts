import { describe, expect, it } from 'vitest';
import { cn, pad2 } from '@/lib/utils';

/**
 * `cn()` là điểm nối trung tâm của MỌI class Tailwind có điều kiện trong app —
 * toàn bộ các đợt "gom công thức về một chỗ" trước đây (vòng focus, easing,
 * bóng) đều dựa vào việc nó merge đúng theo luật của tailwind-merge (class sau
 * thắng class trước nếu cùng nhóm thuộc tính). Một bản nâng cấp `tailwind-merge`
 * đổi hành vi ở đây thì hỏng lặng lẽ khắp app — test này là chỉ báo sớm.
 */
describe('cn', () => {
  it('gộp nhiều chuỗi class thành một', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('bỏ qua giá trị falsy (điều kiện tắt)', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('class sau THẮNG class trước khi cùng nhóm thuộc tính Tailwind (vd cùng là bề rộng)', () => {
    expect(cn('h-4', 'h-6')).toBe('h-6');
  });

  it('class KHÔNG cùng nhóm thì giữ lại cả hai, không cái nào bị loại nhầm', () => {
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold');
  });

  it('mảng lồng nhau được clsx làm phẳng trước khi merge', () => {
    expect(cn(['a', ['b', 'c']])).toBe('a b c');
  });

  it('utility tuỳ ý dạng ring-[3px] vẫn merge đúng với ring-[Npx] khác — công thức vòng focus dùng khắp app dựa vào việc này', () => {
    expect(cn('ring-[3px]', 'ring-[5px]')).toBe('ring-[5px]');
  });
});

describe('pad2', () => {
  it('đệm số 0 phía trước cho số một chữ số', () => {
    expect(pad2(5)).toBe('05');
    expect(pad2(0)).toBe('00');
  });

  it('giữ nguyên số đã đủ hai chữ số trở lên', () => {
    expect(pad2(42)).toBe('42');
    expect(pad2(123)).toBe('123');
  });
});
