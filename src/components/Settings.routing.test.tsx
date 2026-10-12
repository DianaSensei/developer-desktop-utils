import { describe, expect, it, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderSettings } from '@/testSupport/renderSettings';

/**
 * Install deep links navigate to `/settings` with
 * `{ state: { section: 'extensions' } }`; Settings must open that section
 * instead of the default (Appearance).
 */

afterEach(() => {
  cleanup();
});

describe('Settings — mở thẳng vào một mục qua location.state.section', () => {
  it('không có state → mặc định mở Appearance, không phải Extensions', () => {
    renderSettings([{ pathname: '/settings' }]);
    expect(screen.queryByRole('heading', { name: 'Extensions', level: 2 })).toBeNull();
  });

  it('state.section = "extensions" → mở thẳng mục Extensions (màn cài đặt tiện ích)', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'extensions' } }]);
    expect(screen.getByRole('heading', { name: 'Extensions', level: 2 })).toBeTruthy();
  });

  it('state.section không hợp lệ → bỏ qua, vẫn mở Appearance', () => {
    renderSettings([{ pathname: '/settings', state: { section: 'not-a-real-section' } }]);
    expect(screen.queryByRole('heading', { name: 'Extensions', level: 2 })).toBeNull();
  });
});
