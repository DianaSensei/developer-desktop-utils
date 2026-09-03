import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

const posted: unknown[] = [];

beforeAll(async () => {
  vi.stubGlobal('postMessage', (msg: unknown) => posted.push(msg));
  await import('@/workers/regex.worker');
});
beforeEach(() => { posted.length = 0; });

interface Resp { id: number; matches: { index: number; groups: (string | undefined)[] }[]; replaceOutput: string; error: string }

function run(req: { id?: number; pattern: string; flags: string; input: string; replacement?: string; doReplace?: boolean }): Resp {
  (self.onmessage as unknown as (e: MessageEvent) => void)({
    data: { id: req.id ?? 1, replacement: '', doReplace: false, ...req },
  } as MessageEvent);
  return posted[0] as Resp;
}

describe('regex.worker', () => {
  it('không có cờ "g": chỉ trả về MỘT kết quả khớp đầu tiên, dù input có nhiều chỗ khớp', () => {
    const r = run({ pattern: 'a', flags: '', input: 'banana' });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ index: 1, groups: ['a'] });
  });

  it('có cờ "g": trả về TẤT CẢ kết quả khớp, mỗi phần tử groups[0] là cả đoạn khớp', () => {
    const r = run({ pattern: 'a', flags: 'g', input: 'banana' });
    expect(r.matches.map((m) => m.index)).toEqual([1, 3, 5]);
  });

  it('nhóm bắt (capture group) nằm ở groups[1], groups[2]… theo đúng thứ tự khai báo', () => {
    const r = run({ pattern: '(\\w+)@(\\w+)', flags: '', input: 'user@host' });
    expect(r.matches[0].groups).toEqual(['user@host', 'user', 'host']);
  });

  it('nhóm không khớp (optional group) thì phần tử tương ứng là undefined, không phải chuỗi rỗng', () => {
    const r = run({ pattern: '(a)|(b)', flags: 'g', input: 'b' });
    expect(r.matches[0].groups).toEqual(['b', undefined, 'b']);
  });

  it('cờ "y" (sticky) cũng đi theo nhánh "tìm tất cả", giống cờ "g"', () => {
    const r = run({ pattern: 'a', flags: 'gy', input: 'aaa' });
    expect(r.matches).toHaveLength(3);
  });

  it('doReplace=true thì trả cả replaceOutput; doReplace=false thì để trống', () => {
    const withReplace = run({ pattern: 'a', flags: 'g', input: 'banana', replacement: 'O', doReplace: true });
    expect(withReplace.replaceOutput).toBe('bOnOnO');
    posted.length = 0;
    const withoutReplace = run({ pattern: 'a', flags: 'g', input: 'banana', doReplace: false });
    expect(withoutReplace.replaceOutput).toBe('');
  });

  it('pattern rỗng: trả phản hồi rỗng ngay lập tức, không thử biên dịch regex', () => {
    const r = run({ pattern: '', flags: 'g', input: 'anything', doReplace: true, replacement: 'X' });
    expect(r).toMatchObject({ matches: [], replaceOutput: '', error: '' });
  });

  it('pattern không hợp lệ (cú pháp regex sai) trả về thông báo lỗi, không throw ra ngoài worker', () => {
    expect(() => run({ pattern: '(unterminated', flags: '', input: 'x' })).not.toThrow();
    const r = run({ pattern: '(unterminated', flags: '', input: 'x' });
    expect(r.error).not.toBe('');
    expect(r.matches).toEqual([]);
  });

  it('khớp RỖNG (zero-width) không làm worker treo vô hạn — lastIndex tự tăng khi index đứng yên', () => {
    // `x*` khớp chuỗi rỗng ở MỌI vị trí của một input không có 'x' nào — nếu
    // không có bước tự tăng `lastIndex`, `re.exec` sẽ lặp lại cùng vị trí mãi
    // mãi. Input dài 5 ký tự thì có 6 vị trí (đầu, giữa từng ký tự, cuối).
    const r = run({ pattern: 'x*', flags: 'g', input: 'abcde' });
    expect(r.matches).toHaveLength(6);
    expect(r.matches.every((m) => m.groups[0] === '')).toBe(true);
  });

  it('số kết quả khớp bị chặn ở 500 (MAX_MATCHES), không phình vô hạn với input lặp lại', () => {
    const r = run({ pattern: 'a', flags: 'g', input: 'a'.repeat(600) });
    expect(r.matches).toHaveLength(500);
  });

  it('message không đúng hình dạng bị bỏ qua trong im lặng', () => {
    (self.onmessage as unknown as (e: MessageEvent) => void)({ data: { pattern: 'a' } } as unknown as MessageEvent);
    (self.onmessage as unknown as (e: MessageEvent) => void)({ data: null } as MessageEvent);
    expect(posted).toEqual([]);
  });
});
