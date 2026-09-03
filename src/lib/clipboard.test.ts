import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  copyToClipboard, readTextFromClipboard, copyImageToClipboard, readImageFromClipboard,
} from '@/lib/clipboard';

/**
 * Chưa có test nào cho module này, dù `copyToClipboard` là đường đi CHUNG của
 * mọi nút Copy trong app (qua `CopyButton`/`useCopyFeedback`). Test chạy trên
 * môi trường web (jsdom không có `window.__TAURI_INTERNALS__` nên `isTauri`
 * luôn false) — đúng nhánh `navigator.clipboard` mà bản build web thật dùng.
 *
 * jsdom không cài `canvas` (không có `getContext('2d')`/`createImageBitmap`
 * thật), nên nhánh RE-ENCODE ảnh không phải PNG sang PNG (`reencodeToPng` khi
 * `blob.type !== 'image/png'`) không test được có ý nghĩa ở đây — dựng canvas
 * giả để nó "chạy qua" không xác nhận được gì về pixel thật, chỉ tốn công.
 * Nhánh PNG-sẵn (bỏ qua canvas hoàn toàn) và toàn bộ đường ĐỌC ảnh (không đụng
 * canvas) thì test được đầy đủ.
 */

describe('copyToClipboard / readTextFromClipboard', () => {
  const writeText = vi.fn();
  const readText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    readText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText },
      configurable: true,
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('copyToClipboard gọi thẳng navigator.clipboard.writeText với đúng chuỗi', async () => {
    await copyToClipboard('hello world');
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('copyToClipboard KHÔNG nuốt lỗi — quyền bị từ chối phải ném ra cho call site tự xử lý', async () => {
    writeText.mockRejectedValue(new Error('permission denied'));
    await expect(copyToClipboard('x')).rejects.toThrow('permission denied');
  });

  it('readTextFromClipboard trả đúng chuỗi khi đọc được', async () => {
    readText.mockResolvedValue('pasted text');
    await expect(readTextFromClipboard()).resolves.toBe('pasted text');
  });

  it('readTextFromClipboard coi chuỗi rỗng là "không có gì" → null, không phải ""', async () => {
    readText.mockResolvedValue('');
    await expect(readTextFromClipboard()).resolves.toBeNull();
  });

  it('readTextFromClipboard NUỐT lỗi (khác copyToClipboard) — quyền bị từ chối không được chặn ⌘K', async () => {
    readText.mockRejectedValue(new Error('permission denied'));
    await expect(readTextFromClipboard()).resolves.toBeNull();
  });
});

describe('copyImageToClipboard — ảnh đã là PNG sẵn (bỏ qua canvas)', () => {
  const write = vi.fn();
  let capturedItem: Record<string, Blob> | null = null;

  beforeEach(() => {
    capturedItem = null;
    write.mockReset().mockImplementation(async (items: unknown[]) => {
      // `ClipboardItem` thật là opaque; giả một constructor bắt lại đúng
      // object { 'image/png': blob } mà code nguồn truyền vào, để xác nhận
      // đúng MIME type và đúng blob được gửi lên clipboard hệ thống.
      capturedItem = (items[0] as unknown as { record: Record<string, Blob> }).record;
    });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    vi.stubGlobal('ClipboardItem', class {
      record: Record<string, Blob>;
      constructor(record: Record<string, Blob>) { this.record = record; }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('Blob PNG được gửi thẳng lên clipboard dưới khoá "image/png", không đụng canvas', async () => {
    const png = new Blob(['fake-png-bytes'], { type: 'image/png' });
    await copyImageToClipboard(png);
    expect(write).toHaveBeenCalledTimes(1);
    expect(capturedItem?.['image/png']).toBe(png);
  });

  it('nhận cả data: URL — tự fetch rồi mới copy, không cần call site tự giải mã base64', async () => {
    // jsdom hiểu `data:` URL qua `fetch` gốc, trả về đúng Blob với MIME type
    // lấy từ chính data URL.
    const dataUrl = 'data:image/png;base64,ZmFrZS1wbmc=';
    await copyImageToClipboard(dataUrl);
    expect(write).toHaveBeenCalledTimes(1);
    expect(capturedItem?.['image/png'].type).toBe('image/png');
  });
});

describe('readImageFromClipboard', () => {
  const read = vi.fn();
  beforeEach(() => {
    read.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('có ảnh trên clipboard → trả về data URL PNG (không cần canvas, chỉ đọc Blob)', async () => {
    const png = new Blob(['fake-png-bytes'], { type: 'image/png' });
    read.mockResolvedValue([{
      types: ['text/plain', 'image/png'],
      getType: async (t: string) => (t === 'image/png' ? png : new Blob()),
    }]);
    const url = await readImageFromClipboard();
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('clipboard có item nhưng không có type ảnh nào → null, không throw', async () => {
    read.mockResolvedValue([{ types: ['text/plain'], getType: async () => new Blob() }]);
    await expect(readImageFromClipboard()).resolves.toBeNull();
  });

  it('clipboard trống hoàn toàn → null', async () => {
    read.mockResolvedValue([]);
    await expect(readImageFromClipboard()).resolves.toBeNull();
  });

  it('quyền đọc bị từ chối → null, không throw ra ngoài', async () => {
    read.mockRejectedValue(new Error('permission denied'));
    await expect(readImageFromClipboard()).resolves.toBeNull();
  });
});
