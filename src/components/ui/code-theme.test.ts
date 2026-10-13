import { describe, expect, it } from 'vitest';
import { resolveCodeThemeOptions } from '@/components/ui/code-theme';

/**
 * `EditorView.theme()` returns an opaque Extension, so the defaults live in
 * `resolveCodeThemeOptions` where they can be tested: 13px text, 8/12
 * padding, the same on every code surface.
 */
describe('resolveCodeThemeOptions', () => {
  it('mặc định MỘT cỡ chữ, MỘT nhịp đệm cho mọi bề mặt code', () => {
    expect(resolveCodeThemeOptions()).toMatchObject({
      fontSize: '13px',
      paddingY: 8,
      paddingX: 12,
      gutter: 'panel',
      activeLine: true,
      fill: true,
    });
  });

  it('mỗi lựa chọn override đúng một trường, không đụng các trường còn lại', () => {
    expect(resolveCodeThemeOptions({ paddingY: 6 })).toMatchObject({
      fontSize: '13px',
      paddingY: 6,
      paddingX: 12,
    });
    expect(resolveCodeThemeOptions({ paddingY: 0, paddingX: 0 })).toMatchObject({
      paddingY: 0,
      paddingX: 0,
    });
    expect(resolveCodeThemeOptions({ gutter: 'flush', activeLine: false })).toMatchObject({
      gutter: 'flush',
      activeLine: false,
      fontSize: '13px',
    });
  });

  it('paddingY: 0 không bị hiểu nhầm là "chưa đặt" — bẫy kinh điển của `??`  đúng, `||` sai', () => {
    // `paddingY: 0` is used (InlineCodeField); `||` would turn it into 8.
    expect(resolveCodeThemeOptions({ paddingY: 0 }).paddingY).toBe(0);
    expect(resolveCodeThemeOptions({ paddingX: 0 }).paddingX).toBe(0);
  });
});
