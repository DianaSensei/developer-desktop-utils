import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Settings } from '@/components/Settings';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { UpdateProvider } from '@/contexts/UpdateContext';
import { ACCENT_TONES } from '@/lib/accentPreference';
import { storageGet, storageRemove } from '@/lib/persistentStore';

/**
 * Section Appearance mới trong Settings (task G3b) — bộ chọn tone và ngôn ngữ
 * đầu tiên dùng thật `SettingRow`/`SettingGroup` của design kit. Test tập
 * trung vào việc CHỌN thật sự đổi trạng thái và được LƯU LẠI, chứ không chỉ
 * "có render không" (build đã bắt việc đó).
 */

function renderSettings() {
  return render(
    <AppConfigProvider>
      <LocaleProvider>
        <FeatureProvider>
          <OnboardingProvider>
            <UpdateProvider>
              <Settings />
            </UpdateProvider>
          </OnboardingProvider>
        </FeatureProvider>
      </LocaleProvider>
    </AppConfigProvider>,
  );
}

afterEach(() => {
  cleanup();
  storageRemove('devtool-accent');
  storageRemove('devtool-locale');
});

describe('Settings — Appearance — ngôn ngữ', () => {
  it('bấm VI đổi nhãn section sang tiếng Việt và lưu lại', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'VI' }));

    expect(screen.getByText('Ngôn ngữ')).toBeTruthy();
    expect(storageGet('devtool-locale')).toBe('vi');
  });

  it('bấm EN đổi nhãn sang tiếng Anh', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'VI' }));
    expect(screen.getByText('Ngôn ngữ')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'EN' }));
    expect(screen.getByText('Language')).toBeTruthy();
    expect(storageGet('devtool-locale')).toBe('en');
  });
});

describe('Settings — Appearance — tone chủ đạo', () => {
  it('hiện đủ 4 swatch, đúng số preset của kit', () => {
    renderSettings();
    // Mỗi radio không có aria-label riêng nên tên truy cập của nó rơi về
    // `title` (tên tone) — "Accent tone" là tên của cả NHÓM, không phải từng nút.
    expect(screen.getByRole('radiogroup', { name: 'Accent tone' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(ACCENT_TONES.length);
  });

  it('bấm một swatch: đánh dấu checked, lưu lại, và ghi lên <html data-accent>', () => {
    renderSettings();
    const teal = screen.getByRole('radio', { name: 'teal' });
    fireEvent.click(teal);

    expect(teal.getAttribute('aria-checked')).toBe('true');
    expect(storageGet('devtool-accent')).toBe('teal');
    expect(document.documentElement.dataset.accent).toBe('teal');
  });

  it('chỉ một swatch được chọn tại một thời điểm', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'amber' }));
    fireEvent.click(screen.getByRole('radio', { name: 'teal' }));

    const checked = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('title')).toBe('teal');
  });
});
