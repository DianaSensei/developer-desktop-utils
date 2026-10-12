import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

const posted: unknown[] = [];

beforeAll(async () => {
  vi.stubGlobal('postMessage', (msg: unknown) => posted.push(msg));
  await import('@/workers/deduplicate.worker');
});
beforeEach(() => { posted.length = 0; });

function run(input: string, mode: 'preserve' | 'sort') {
  (self.onmessage as unknown as (e: MessageEvent) => void)({ data: { input, mode } } as MessageEvent);
  return posted[0] as { output: string; original: number; unique: number; removed: number };
}

describe('deduplicate.worker', () => {
  it('mode "preserve": loại trùng, GIỮ thứ tự lần xuất hiện đầu tiên', () => {
    const r = run('b\na\nb\nc\na', 'preserve');
    expect(r.output).toBe('b\na\nc');
    expect(r).toMatchObject({ original: 5, unique: 3, removed: 2 });
  });

  it('mode "sort": loại trùng rồi sắp theo alphabet, không giữ thứ tự gốc', () => {
    const r = run('b\na\nb\nc\na', 'sort');
    expect(r.output).toBe('a\nb\nc');
  });

  it('mỗi dòng bị trim(), và dòng rỗng sau khi trim KHÔNG được tính vào "original"', () => {
    // Whitespace-only and empty lines are dropped before counting, or
    // "removed" would overstate the duplicates.
    const r = run('a\n  \n\nb\n a ', 'preserve');
    expect(r.original).toBe(3); // 'a', 'b', 'a' (đã trim) — không tính 2 dòng rỗng
    expect(r.output).toBe('a\nb');
  });

  it('message không đúng hình dạng (thiếu input, hoặc mode lạ) bị bỏ qua trong im lặng', () => {
    (self.onmessage as unknown as (e: MessageEvent) => void)({ data: { input: 123, mode: 'preserve' } } as unknown as MessageEvent);
    (self.onmessage as unknown as (e: MessageEvent) => void)({ data: { input: 'a', mode: 'shuffle' } } as unknown as MessageEvent);
    (self.onmessage as unknown as (e: MessageEvent) => void)({ data: null } as MessageEvent);
    expect(posted).toEqual([]);
  });

  it('input rỗng → output rỗng, mọi số đếm đều 0, không lỗi', () => {
    const r = run('', 'preserve');
    expect(r).toEqual({ output: '', original: 0, unique: 0, removed: 0 });
  });
});
