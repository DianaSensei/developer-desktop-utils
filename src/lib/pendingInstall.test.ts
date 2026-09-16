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
    expect(pendingInstall.dequeue()).toBe('https://a/1.json');
    expect(pendingInstall.dequeue()).toBe('https://a/2.json');
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('tự trim khoảng trắng và bỏ chuỗi rỗng khi enqueue', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['  https://a/1.json  ', '', '   ']);
    expect(pendingInstall.dequeue()).toBe('https://a/1.json');
    expect(pendingInstall.dequeue()).toBeNull();
  });

  it('enqueue nối tiếp vào hàng đợi hiện có, không ghi đè', async () => {
    const { pendingInstall } = await import('@/lib/pendingInstall');
    pendingInstall.enqueue(['https://a/1.json']);
    pendingInstall.enqueue(['https://a/2.json']);
    expect(pendingInstall.dequeue()).toBe('https://a/1.json');
    expect(pendingInstall.dequeue()).toBe('https://a/2.json');
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
});
