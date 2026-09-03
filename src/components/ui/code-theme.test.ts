import { describe, expect, it } from 'vitest';
import { resolveCodeThemeOptions } from '@/components/ui/code-theme';

/**
 * `EditorView.theme()` trả về một `Extension` không đọc lại được, nên phần
 * MẶC ĐỊNH của lớp chuyển động/mật độ chữ trong mọi bề mặt code của app được
 * tách ra thành `resolveCodeThemeOptions` chỉ để có chỗ kiểm — xem ghi chú ở
 * đó. Test này khoá đúng bộ mặc định đã thống nhất (13px, 8/12 padding),
 * trước đây là ba cỡ chữ khác nhau (12 / 12.5 / 13) trôi dạt qua bốn nơi gọi
 * mà không ai để ý cho tới khi có người đặt trình soạn thân request cạnh
 * trình xem response và thấy chữ hai bên không cùng cỡ.
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
    // `paddingY: 0` là một lựa chọn có thật (InlineCodeField) — nếu hàm dùng
    // `||` thay vì `??` để điền mặc định, `0` sẽ bị coi là falsy và ghi đè
    // ngược lại thành 8, và ô địa chỉ URL đột nhiên có đệm dọc không ai đặt.
    expect(resolveCodeThemeOptions({ paddingY: 0 }).paddingY).toBe(0);
    expect(resolveCodeThemeOptions({ paddingX: 0 }).paddingX).toBe(0);
  });
});
