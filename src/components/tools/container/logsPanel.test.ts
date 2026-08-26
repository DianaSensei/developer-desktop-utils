import { describe, expect, it } from 'vitest';
import { buildMatcher, formatTimestamp } from '@/components/tools/container/LogsPanel';

describe('buildMatcher', () => {
  it('truy vấn rỗng không lọc gì', () => {
    const m = buildMatcher('   ', false, false);
    expect(m.test).toBeNull();
    expect(m.ranges).toBeNull();
    expect(m.error).toBeNull();
  });

  it('tìm chuỗi thường, mặc định không phân biệt hoa thường', () => {
    const m = buildMatcher('ERROR', false, false);
    expect(m.test!('unhandled error at boot')).toBe(true);
    expect(m.ranges!('unhandled error at boot')).toEqual([[10, 15]]);
  });

  it('bật phân biệt hoa thường thì bỏ qua khác case', () => {
    const m = buildMatcher('ERROR', false, true);
    expect(m.test!('unhandled error')).toBe(false);
    expect(m.test!('unhandled ERROR')).toBe(true);
  });

  it('trả về mọi lần khớp trong một dòng', () => {
    const m = buildMatcher('ab', false, false);
    expect(m.ranges!('ab-ab-ab')).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it('chế độ regex khớp theo mẫu', () => {
    const m = buildMatcher('GET /(users|orders)', true, false);
    expect(m.error).toBeNull();
    expect(m.test!('GET /users 200')).toBe(true);
    expect(m.test!('GET /health 200')).toBe(false);
  });

  it('regex có state không rò rỉ giữa các lần gọi', () => {
    // RegExp cờ /g nhớ lastIndex — nếu không reset, dòng thứ hai sẽ trượt.
    const m = buildMatcher('a', true, false);
    expect(m.test!('aaa')).toBe(true);
    expect(m.test!('aaa')).toBe(true);
    expect(m.ranges!('aaa')).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(m.ranges!('aaa')).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('regex khớp rỗng không treo vòng lặp', () => {
    const m = buildMatcher('x*', true, false);
    expect(m.ranges!('axxb')).toEqual([[1, 3]]);
  });

  it('regex sai cú pháp báo lỗi thay vì ném ra ngoài', () => {
    const m = buildMatcher('foo(', true, false);
    expect(m.error).toBeTruthy();
    expect(m.test).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('rút gọn RFC3339 về giờ:phút:giây.mili', () => {
    expect(formatTimestamp('2026-08-26T09:41:02.123456789Z')).toBe('09:41:02.123');
  });

  it('giữ nguyên khi không có phần thập phân', () => {
    expect(formatTimestamp('2026-08-26T09:41:02Z')).toBe('09:41:02');
  });

  it('trả nguyên chuỗi nếu không phải định dạng có T', () => {
    expect(formatTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
  });
});
