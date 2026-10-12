import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

/**
 * The worker's only surface is `self.onmessage`. Importing the module
 * installs the handler (in jsdom `self === window`); the tests call it and
 * check the `postMessage` sequence.
 */

const posted: unknown[] = [];

beforeAll(async () => {
  vi.stubGlobal('postMessage', (msg: unknown) => posted.push(msg));
  // Configure the environment before loading the module.
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
    // percent is clamped to 99 even on the last chunk; 100% is implied by
    // "result". The UI relies on this.
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
    // Each `file.slice()` returns a new Blob, so mock
    // `Blob.prototype.arrayBuffer` to simulate a read error midway.
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
