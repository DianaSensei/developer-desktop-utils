import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

/**
 * `self.onmessage = …` là toàn bộ bề mặt public của worker này — không có gì
 * export. Import module để nó tự gắn handler lên `self` (worker global; trong
 * jsdom `self === window`), rồi gọi thẳng handler như một hàm để kiểm tra
 * chuỗi `postMessage` nó phát ra. Chưa có test nào trước đây — và đây là nơi
 * người dùng tính checksum một file thật, sai kết quả thì không ai biết.
 */

const posted: unknown[] = [];

beforeAll(async () => {
  vi.stubGlobal('postMessage', (msg: unknown) => posted.push(msg));
  // Import SAU KHI stub `postMessage` — module gọi `self.postMessage` bên
  // trong closure của `self.onmessage`, được resolve LÚC GỌI (không phải lúc
  // import), nên thứ tự này không bắt buộc về mặt kỹ thuật, nhưng giữ đúng
  // trực giác "cấu hình môi trường trước khi nạp module".
  await import('@/workers/checksum.worker');
});

beforeEach(() => { posted.length = 0; });

async function run(file: File, algo: string) {
  await (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)(
    { data: { file, algo } } as MessageEvent,
  );
}

describe('checksum.worker', () => {
  it('MD5 của chuỗi rỗng khớp vector đã biết', async () => {
    const file = new File([''], 'empty.txt');
    await run(file, 'md5');
    const result = posted.find((m) => (m as { type: string }).type === 'result') as { hash: string };
    expect(result.hash).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('SHA-256 của "abc" khớp vector chuẩn FIPS 180-2', async () => {
    const file = new File(['abc'], 'abc.txt');
    await run(file, 'sha256');
    const result = posted.find((m) => (m as { type: string }).type === 'result') as { hash: string };
    expect(result.hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('SHA-1 và SHA-512 cũng khớp giá trị từ node:crypto (cài đặt độc lập) cho "abc"', async () => {
    await run(new File(['abc'], 'a.txt'), 'sha1');
    expect((posted.find((m) => (m as { type: string }).type === 'result') as { hash: string }).hash)
      .toBe('a9993e364706816aba3e25717850c26c9cd0d89d');

    posted.length = 0;
    await run(new File(['abc'], 'a.txt'), 'sha512');
    expect((posted.find((m) => (m as { type: string }).type === 'result') as { hash: string }).hash)
      .toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  });

  it('phát ít nhất một thông báo "progress" trước "result", và percent không bao giờ chạm 100 trong lúc chạy', async () => {
    // percent bị kẹp `Math.min(99, …)` NGAY CẢ ở chunk cuối cùng — 100% chỉ
    // được ngầm hiểu qua việc nhận "result", không bao giờ xuất hiện trong
    // "progress". Đây là hành vi có chủ đích (ghi lại để không ai "sửa nhầm"
    // percent cuối thành 100 rồi phá vỡ UI đang coi 100% progress + chưa có
    // result là "vẫn đang chạy").
    await run(new File(['x'.repeat(1000)], 'f.txt'), 'md5');
    const progresses = posted.filter((m) => (m as { type: string }).type === 'progress') as { percent: number }[];
    expect(progresses.length).toBeGreaterThan(0);
    for (const p of progresses) expect(p.percent).toBeLessThanOrEqual(99);
    expect(posted[posted.length - 1]).toMatchObject({ type: 'result' });
  });

  it('message không đúng hình dạng (thiếu file, hoặc algo lạ) bị bỏ qua trong im lặng', async () => {
    await run({ file: undefined, algo: 'md5' } as unknown as File, 'md5');
    await (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)({ data: { file: new File([''], 'x'), algo: 'crc32' } } as MessageEvent);
    await (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)({ data: null } as MessageEvent);
    expect(posted).toEqual([]);
  });

  it('lỗi khi đọc file (vd file bị đổi/xoá giữa chừng) phát một thông báo "error", không làm worker crash im lặng', async () => {
    // Worker đọc TỪNG CHUNK qua `file.slice(...).arrayBuffer()` — `slice()`
    // trả về một Blob MỚI mỗi lần gọi, nên mock trên chính `file` không chặn
    // được gì; phải chặn `Blob.prototype.arrayBuffer` (lớp cha mà slice() trả
    // về cũng kế thừa) để mô phỏng lỗi đọc giữa chừng.
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValue(new Error('file gone'));
    try {
      const file = new File(['abc'], 'a.txt');
      await run(file, 'md5');
      expect(posted).toEqual([{ type: 'error', message: 'Error: file gone' }]);
    } finally {
      spy.mockRestore();
    }
  });
});
