import { describe, expect, it, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderSettings } from '@/testSupport/renderSettings';
import { ACCENT_TONES } from '@/lib/accentPreference';
import { storageGet, storageRemove } from '@/lib/persistentStore';

/**
 * Appearance section: choosing a tone or language changes state and is
 * saved.
 */

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
    // "Accent tone" names the group; each radio is named by its `title`.
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
