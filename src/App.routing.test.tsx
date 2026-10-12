import { describe, expect, it, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import App from '@/App';
import { storageSet, storageRemove } from '@/lib/persistentStore';
import { TOOL_DEFS } from '@/lib/toolDefs';

/**
 * Unmatched URLs (including '/', which belongs to a tool the user can
 * disable) must land on an enabled tool rather than a blank content area.
 */

/** Enables exactly these tools. FeatureProvider merges stored values over
 *  defaults, so every other tool is written as disabled. */
function enableOnly(...ids: string[]) {
  const features = Object.fromEntries(TOOL_DEFS.map((d) => [d.id, ids.includes(d.id)]));
  storageSet('devtool-features', JSON.stringify({ ...features, settings: true }));
}

// jsdom lacks `matchMedia` and `ResizeObserver`, both used by App on
// mount (useThemeSync, sidebar overflow fade).
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
    // Leaving '/' is the point: that is where the blank page used to be.
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
