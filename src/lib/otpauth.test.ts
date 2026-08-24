import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from '@/lib/otpauth';

/**
 * Secret 2FA gần như luôn được COPY từ trang cấu hình của dịch vụ, nên nó tới
 * tay tool ở đủ mọi hình dạng: chia nhóm 4 ký tự bằng dấu cách, viết thường,
 * kèm padding '=', và thường dính thêm khoảng trắng thừa ở hai đầu. Bộ test này
 * khoá lại việc mọi biến thể đó cùng giải ra một khoá — sai ở đây nghĩa là
 * người dùng thấy "Invalid character" cho một secret hoàn toàn hợp lệ.
 */

const bytes = (...b: number[]) => new Uint8Array(b);
const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');

describe('base32Decode', () => {
  it('giải đúng vector RFC 4648 ("Hello!" → JBSWY3DPEHPK3PXP là ví dụ phổ biến)', () => {
    expect(new TextDecoder().decode(base32Decode('JBSWY3DPEB3W64TMMQ'))).toBe('Hello world');
  });

  it('bỏ qua khoảng trắng chia nhóm và chữ thường', () => {
    const canonical = hex(base32Decode('JBSWY3DPEHPK3PXP'));
    expect(hex(base32Decode('JBSW Y3DP EHPK 3PXP'))).toBe(canonical);
    expect(hex(base32Decode('jbswy3dpehpk3pxp'))).toBe(canonical);
    expect(hex(base32Decode('  JBSW\ty3dp\nEHPK 3PXP  '))).toBe(canonical);
  });

  it('bỏ padding "=" kể cả khi sau nó còn khoảng trắng', () => {
    // Thứ tự strip sai (cắt '=' trước khi bỏ khoảng trắng) làm chuỗi này ném lỗi.
    const canonical = hex(base32Decode('JBSWY3DP'));
    expect(hex(base32Decode('JBSWY3DP===='))).toBe(canonical);
    expect(hex(base32Decode('JBSWY3DP====  '))).toBe(canonical);
    expect(hex(base32Decode('JBSW Y3DP ==== \n'))).toBe(canonical);
  });

  it('vẫn báo lỗi cho ký tự thật sự nằm ngoài bảng chữ Base32', () => {
    expect(() => base32Decode('JBSW1Y3DP')).toThrow(/Invalid character/);
  });

  it('round-trip với base32Encode', () => {
    const raw = bytes(0x00, 0x0f, 0x7f, 0x80, 0xff, 0xa5, 0x5a);
    expect(hex(base32Decode(base32Encode(raw)))).toBe(hex(raw));
  });
});
