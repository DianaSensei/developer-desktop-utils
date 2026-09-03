import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, parseOtpImport } from '@/lib/otpauth';

/**
 * Secret 2FA gần như luôn được COPY từ trang cấu hình của dịch vụ, nên nó tới
 * tay tool ở đủ mọi hình dạng: chia nhóm 4 ký tự bằng dấu cách, viết thường,
 * kèm padding '=', và thường dính thêm khoảng trắng thừa ở hai đầu. Bộ test này
 * khoá lại việc mọi biến thể đó cùng giải ra một khoá — sai ở đây nghĩa là
 * người dùng thấy "Invalid character" cho một secret hoàn toàn hợp lệ.
 *
 * Mở rộng thêm phần trình đọc protobuf tối giản đứng sau việc import mã 2FA từ
 * Google Authenticator / 2FAS / Aegis / Authy... — logic BẢO MẬT: đọc sai
 * secret hoặc sai counter thì mã OTP sinh ra sai mà người dùng không có cách
 * nào tự phát hiện, ngoài việc đăng nhập thất bại.
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

describe('base32Encode', () => {
  it('mã hoá đúng vector RFC 4648 ("foobar" → MZXW6YTBOI, không đệm "=")', () => {
    expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
  });
});

// ─── Bộ dựng protobuf tối giản, khớp với field layout mà otpauth.ts đọc ────
// (1=secret bytes, 2=name, 3=issuer, 4=algorithm, 5=digits, 6=type, 7=counter;
// bọc trong field 1 lặp lại của message di trú Google Authenticator.)
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}
function tag(field: number, wire: number): number[] { return varint((field << 3) | wire); }
function bytesField(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}
function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}
function strBytes(s: string): number[] { return Array.from(new TextEncoder().encode(s)); }

interface OtpParamsSpec {
  secret: number[];
  name?: string;
  issuer?: string;
  algorithm?: number; // 1=SHA1 2=SHA256 3=SHA512
  digits?: number;    // 1=SIX 2=EIGHT
  type?: number;      // 1=HOTP 2=TOTP
  counter?: number;
}
function buildOtpParams(spec: OtpParamsSpec): number[] {
  const out: number[] = [...bytesField(1, spec.secret)];
  if (spec.name !== undefined) out.push(...bytesField(2, strBytes(spec.name)));
  if (spec.issuer !== undefined) out.push(...bytesField(3, strBytes(spec.issuer)));
  if (spec.algorithm !== undefined) out.push(...varintField(4, spec.algorithm));
  if (spec.digits !== undefined) out.push(...varintField(5, spec.digits));
  if (spec.type !== undefined) out.push(...varintField(6, spec.type));
  if (spec.counter !== undefined) out.push(...varintField(7, spec.counter));
  return out;
}
function buildMigrationUri(entries: OtpParamsSpec[]): string {
  const payload: number[] = [];
  for (const e of entries) payload.push(...bytesField(1, buildOtpParams(e)));
  const bin = String.fromCharCode(...payload);
  const b64 = btoa(bin);
  return `otpauth-migration://offline?data=${encodeURIComponent(b64)}`;
}

describe('parseOtpImport — otpauth:// (chuẩn, dùng bởi 2FAS/Aegis/Authy/1Password…)', () => {
  it('đọc đủ mọi tham số của một URI TOTP', () => {
    const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60';
    const [otp] = parseOtpImport(uri);
    expect(otp).toEqual({
      type: 'totp', name: 'alice@example.com', issuer: 'Example',
      secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-256', digits: 8, period: 60, counter: 0,
    });
  });

  it('URI HOTP đọc được counter, mặc định algorithm/digits/period khi không có', () => {
    const uri = 'otpauth://hotp/Acme?secret=JBSWY3DPEHPK3PXP&counter=42';
    const [otp] = parseOtpImport(uri);
    expect(otp).toMatchObject({ type: 'hotp', algorithm: 'SHA-1', digits: 6, period: 30, counter: 42 });
  });

  it('nhãn dạng "Issuer:account" tách issuer/name khi không có param issuer riêng', () => {
    const uri = 'otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP';
    const [otp] = parseOtpImport(uri);
    expect(otp).toMatchObject({ issuer: 'GitHub', name: 'octocat' });
  });

  it('param issuer THẮNG issuer suy ra từ nhãn khi cả hai đều có', () => {
    const uri = 'otpauth://totp/LabelIssuer:acct?secret=JBSWY3DPEHPK3PXP&issuer=RealIssuer';
    const [otp] = parseOtpImport(uri);
    expect(otp?.issuer).toBe('RealIssuer');
  });

  it('thiếu secret thì bỏ qua URI đó, không sinh ra một entry rỗng nguy hiểm', () => {
    expect(parseOtpImport('otpauth://totp/Example?issuer=X')).toEqual([]);
  });

  it('digits=0 rơi về mặc định 6 (không phải kẹp về 1) — `parseInt(\'0\') || 6` coi 0 là "chưa có"', () => {
    // Đây là hành vi THẬT của code, không phải điều tôi muốn nó làm: chuỗi
    // "0" hợp lệ về cú pháp, nhưng `0 || 6` trong nguồn coi số 0 là falsy nên
    // rơi về mặc định — giống hệt như không truyền digits. Ghi lại ranh giới
    // này để không ai "sửa" nó thành 1 rồi phá vỡ trường hợp digits thật sự
    // vắng mặt (cũng đi qua đúng nhánh `|| 6` đó).
    const uri = 'otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&digits=0';
    expect(parseOtpImport(uri)[0]?.digits).toBe(6);
  });

  it('digits ÂM thì bị Math.max kẹp về tối thiểu 1', () => {
    const uri = 'otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&digits=-5';
    expect(parseOtpImport(uri)[0]?.digits).toBe(1);
  });

  it('period không phải số (chữ) thì rơi về mặc định 30, không phải NaN', () => {
    const uri = 'otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&period=abc';
    expect(parseOtpImport(uri)[0]?.period).toBe(30);
  });

  it('quét được NHIỀU URI trong cùng một khối text (file export, JSON, …)', () => {
    const text = `
      some notes
      otpauth://totp/A?secret=JBSWY3DPEHPK3PXP
      "backup": "otpauth://totp/B?secret=KRSXG5A="
    `;
    const results = parseOtpImport(text);
    expect(results.map((o) => o.name)).toEqual(['A', 'B']);
  });

  it('secret có khoảng trắng bị gộp lại và viết hoa', () => {
    const uri = 'otpauth://totp/X?secret=jbsw%20y3dp%20ehpk%203pxp';
    // %20 đã decode bởi URLSearchParams thành khoảng trắng thật trước khi lọc.
    const [otp] = parseOtpImport(uri);
    expect(otp?.secret).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('parseOtpImport — otpauth-migration:// (Google Authenticator export)', () => {
  it('đọc một entry TOTP đầy đủ: secret giải mã đúng, tên tách từ "Issuer:account"', () => {
    const secretBytes = Array.from(base32Decode('JBSWY3DPEHPK3PXP'));
    const uri = buildMigrationUri([{
      secret: secretBytes, name: 'Example:alice@example.com', algorithm: 2, digits: 2, type: 2,
    }]);
    const [otp] = parseOtpImport(uri);
    expect(otp).toMatchObject({
      type: 'totp', name: 'alice@example.com', issuer: 'Example',
      algorithm: 'SHA-256', digits: 8, period: 30,
    });
    expect(Array.from(base32Decode(otp.secret))).toEqual(secretBytes);
  });

  it('đọc đúng NHIỀU entry trong một payload di trú, giữ nguyên thứ tự', () => {
    const uri = buildMigrationUri([
      { secret: strBytes('secret-one-'), name: 'First' },
      { secret: strBytes('secret-two-'), name: 'Second', type: 1, counter: 7 },
    ]);
    const results = parseOtpImport(uri);
    expect(results.map((o) => o.name)).toEqual(['First', 'Second']);
    expect(results[0].type).toBe('totp');
    expect(results[1]).toMatchObject({ type: 'hotp', counter: 7 });
  });

  it('entry không có secret bytes bị loại khỏi kết quả, không tạo mã OTP vô nghĩa', () => {
    const uri = buildMigrationUri([{ secret: [], name: 'Empty' }]);
    expect(parseOtpImport(uri)).toEqual([]);
  });

  it('không tên (name rỗng) thì dùng "Account" làm tên mặc định', () => {
    const uri = buildMigrationUri([{ secret: strBytes('x') }]);
    const [otp] = parseOtpImport(uri);
    expect(otp.name).toBe('Account');
  });

  it('algorithm=4 (MD5, không hỗ trợ) rơi về SHA-1 thay vì sinh giá trị rác', () => {
    const uri = buildMigrationUri([{ secret: strBytes('x'), algorithm: 4 }]);
    expect(parseOtpImport(uri)[0].algorithm).toBe('SHA-1');
  });

  it('dữ liệu base64 hỏng thì bỏ qua trong im lặng, không ném lỗi làm crash cả lần import', () => {
    expect(() => parseOtpImport('otpauth-migration://offline?data=%%%not-base64%%%')).not.toThrow();
    expect(parseOtpImport('otpauth-migration://offline?data=%%%not-base64%%%')).toEqual([]);
  });
});

describe('parseOtpImport — text không chứa URI OTP nào', () => {
  it('trả mảng rỗng, không throw', () => {
    expect(parseOtpImport('just some random text, no otp here')).toEqual([]);
    expect(parseOtpImport('')).toEqual([]);
  });
});
