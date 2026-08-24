import { describe, expect, it, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import App from '@/App';
import { storageSet, storageRemove } from '@/lib/persistentStore';
import { TOOL_DEFS } from '@/lib/toolDefs';

/**
 * Route `/` KHÔNG phải một trang riêng — nó thuộc về Cron Generator (xem
 * `TOOL_ROUTES` trong lib/toolRegistry.ts). Mà Cron Generator lại tắt được như
 * mọi tool khác trong Settings. Trước khi có `<Route path="*">`, tắt nó xong mở
 * lại app là rơi vào đúng `/`, không route nào khớp, và vùng nội dung trống
 * trơn — trong khi header vẫn vẽ tên tool đã tắt, nên trông y như app hỏng chứ
 * không phải như một lựa chọn của người dùng.
 *
 * Cùng cái bẫy đó áp cho mọi URL không khớp (deep link cũ, tool bị tắt sau khi
 * đã điều hướng tới). Bộ test này khoá lại: luôn có một tool hiện ra.
 */

/** Bật đúng những tool được liệt kê, tắt phần còn lại — `FeatureProvider` trộn
 *  giá trị lưu lên trên mặc định, nên chỉ ghi một phần sẽ để lại cả tá tool
 *  mặc-định-bật và làm đích rơi về không đoán trước được. */
function enableOnly(...ids: string[]) {
  const features = Object.fromEntries(TOOL_DEFS.map((d) => [d.id, ids.includes(d.id)]));
  storageSet('devtool-features', JSON.stringify({ ...features, settings: true }));
}

// jsdom không cài `matchMedia` lẫn `ResizeObserver`; App gọi cả hai ngay lúc
// dựng (useThemeSync và fade tràn của danh sách nav trong sidebar).
beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
  storageRemove('devtool-features');
  storageRemove('devtool-tool-order');
  storageRemove('devtool-onboarding-seen');
  window.history.pushState({}, '', '/');
});

describe('App — route dự phòng', () => {
  it('mở "/" khi Cron Generator đang BẬT thì ở nguyên "/" và dựng Cron Generator', async () => {
    enableOnly('cron-generator');
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText('Cron Generator').length).toBeGreaterThan(0);
    });
    expect(window.location.pathname).toBe('/');
  });

  it('mở "/" khi Cron Generator đã TẮT thì chuyển sang tool đang bật, không để trống', async () => {
    enableOnly('json');
    render(<App />);
    // Rời khỏi '/' là điểm mấu chốt — đó chính là chỗ bản cũ đứng lại và trắng.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/json');
    });
  });

  it('URL không tồn tại cũng rơi về một tool đang bật', async () => {
    enableOnly('json');
    window.history.pushState({}, '', '/khong-he-ton-tai');
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/json');
    });
  });

  it('tắt hết tool thì rơi về Settings, vẫn còn thứ để dùng', async () => {
    enableOnly();
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/settings');
    });
  });
});
