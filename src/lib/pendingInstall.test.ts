import { describe, expect, it, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
});

describe('pendingInstall', () => {
  it('dequeue trên hàng đợi rỗng trả về null, không ném lỗi', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('enqueue rồi dequeue theo đúng thứ tự FIFO', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['https://a/1.json', 'https://a/2.json']);
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://a/1.json', marketId: undefined });
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://a/2.json', marketId: undefined });
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('tự trim khoảng trắng và bỏ chuỗi rỗng khi enqueue', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['  https://a/1.json  ', '', '   ']);
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://a/1.json', marketId: undefined });
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('enqueue thay thế hàng đợi cũ, không nối vào cuối — link mới thắng link cũ chưa xử lý xong', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    // Mô phỏng: link cài plugin A tới trước (2 URL: plugin + service), người
    // dùng chưa xác nhận xong bước cài plugin thì link cài plugin B tới —
    // B phải được xử lý ngay, không phải xếp sau phần còn treo của A.
    pendingInstall.enqueue(['https://a/plugin.json', 'https://a/service.json']);
    pendingInstall.enqueue(['https://b/plugin.json']);
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://b/plugin.json', marketId: undefined });
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('gắn marketId cho mọi URL trong cùng một lần enqueue', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['https://a/plugin.json', 'https://a/service.json'], 'official');
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://a/plugin.json', marketId: 'official' });
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://a/service.json', marketId: 'official' });
  });

  it('marketId của lần enqueue MỚI thắng — không trộn với marketId của lần trước', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['https://a/plugin.json'], 'official');
    pendingInstall.enqueue(['https://b/plugin.json'], 'custom-fork');
    expect(pendingInstall.dequeue()).toEqual({ url: 'https://b/plugin.json', marketId: 'custom-fork' });
  });

  it('không truyền marketId (deep link) thì marketId là undefined', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['https://a/plugin.json']);
    expect(pendingInstall.dequeue()?.marketId).toBeUndefined();
  });

  it('subscribe được gọi khi enqueue thêm URL mới', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    const listener = vi.fn();
    const unsubscribe = pendingInstall.subscribe(listener);
    pendingInstall.enqueue(['https://a/1.json']);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    pendingInstall.enqueue(['https://a/2.json']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('enqueue toàn chuỗi rỗng/khoảng trắng không báo listener (không có gì thay đổi)', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    const listener = vi.fn();
    pendingInstall.subscribe(listener);
    pendingInstall.enqueue(['', '   ']);
    expect(listener).not.toHaveBeenCalled();
    expect(pendingInstall.dequeue()).toBeNull();
  });

  describe('dequeueAll', () => {
    it('rỗng khi hàng đợi rỗng', async () => {
      const { pendingInstall } = await import('@/lib/pendingInstall');
      expect(pendingInstall.dequeueAll()).toEqual([]);
    });

    it('lấy và xoá TOÀN BỘ hàng đợi cùng lúc, giữ đúng thứ tự', async () => {
      const { pendingInstall } = await import('@/lib/pendingInstall');
      pendingInstall.enqueue(['https://a/plugin.json', 'https://a/service.json'], 'official');
      expect(pendingInstall.dequeueAll()).toEqual([
        { url: 'https://a/plugin.json', marketId: 'official' },
        { url: 'https://a/service.json', marketId: 'official' },
      ]);
      expect(pendingInstall.dequeueAll()).toEqual([]);
    });
  });
});
