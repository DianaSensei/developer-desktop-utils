import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '@/components/Settings';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { UpdateProvider } from '@/contexts/UpdateContext';
import { ExtensionUpdateProvider } from '@/contexts/ExtensionUpdateContext';

/**
 * `devtool://install?...` (src/lib/deepLink.ts) điều hướng tới `/settings`
 * với `{ state: { section: 'plugins' } }` để mở thẳng màn cài đặt tiện ích —
 * xác nhận Settings thực sự đọc `location.state.section` này, chứ không rơi
 * về mục mặc định (Appearance). Bug này chính là finding pullfrog nêu trên
 * PR #126: điều hướng tới `/settings` không tự chọn mục nào cả.
 */

function renderSettings(initialEntries: Array<{ pathname: string; state?: unknown }>) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppConfigProvider>
        <LocaleProvider>
          <FeatureProvider>
            <OnboardingProvider>
              <UpdateProvider>
                <ExtensionUpdateProvider>
                  <Settings />
                </ExtensionUpdateProvider>
              </UpdateProvider>
            </OnboardingProvider>
          </FeatureProvider>
        </LocaleProvider>
      </AppConfigProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('Settings — mở thẳng vào một mục qua location.state.section', () => {
  it('không có state → mặc định mở Appearance, không phải Plugin', () => {
    renderSettings([{ pathname: '/settings' }]);
    expect(screen.queryByRole('heading', { name: 'Plugins', level: 2 })).toBeNull();
  });

  it('state.section = "plugins" → mở thẳng mục Plugin (màn cài đặt tiện ích)', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'plugins' } }]);
    expect(screen.getByRole('heading', { name: 'Plugins', level: 2 })).toBeTruthy();
  });

  it('state.section không hợp lệ → bỏ qua, vẫn mở Appearance', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'not-a-real-section' } }]);
    expect(screen.queryByRole('heading', { name: 'Plugins', level: 2 })).toBeNull();
  });
});
