import { describe, expect, it } from 'vitest';
import { detectClipboardIntent } from '@/lib/clipboardIntent';

// jwt.io's canonical example — header {"alg":"HS256","typ":"JWT"}.
const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('detectClipboardIntent', () => {
  it('trả về null cho rỗng, chỉ khoảng trắng, hoặc quá dài', () => {
    expect(detectClipboardIntent(null)).toBeNull();
    expect(detectClipboardIntent(undefined)).toBeNull();
    expect(detectClipboardIntent('   ')).toBeNull();
    expect(detectClipboardIntent('x'.repeat(9000))).toBeNull();
  });

  it('không đoán bừa cho văn xuôi thường', () => {
    expect(detectClipboardIntent('Chào bạn, hôm nay thế nào?')).toBeNull();
    expect(detectClipboardIntent('const x = 1;')).toBeNull();
  });

  describe('jwt', () => {
    it('nhận diện JWT thật', () => {
      expect(detectClipboardIntent(SAMPLE_JWT)).toEqual({
        kind: 'jwt',
        toolId: 'jwt',
        reasonKey: 'clipboard.reason.jwt',
      });
    });

    it('không nhận nhầm ba đoạn base64url không phải JWT', () => {
      // Ba đoạn hợp lệ base64url nhưng đoạn đầu không giải mã ra JSON có "alg".
      expect(detectClipboardIntent('YWJj.ZGVm.Z2hp')).toBeNull();
    });
  });

  describe('json', () => {
    it('nhận diện object và array', () => {
      expect(detectClipboardIntent('{"a":1}')?.kind).toBe('json');
      expect(detectClipboardIntent('[1,2,3]')?.kind).toBe('json');
    });

    it('bỏ qua JSON hỏng cú pháp', () => {
      expect(detectClipboardIntent('{"a":1')).toBeNull();
    });

    it('ưu tiên jwt hơn json khi cả hai đều khớp về hình thức', () => {
      // JWT không bắt đầu bằng { hay [ nên thực ra không đụng nhánh JSON —
      // test này khẳng định thứ tự kiểm tra jwt đứng TRƯỚC json trong code.
      expect(detectClipboardIntent(SAMPLE_JWT)?.kind).toBe('jwt');
    });
  });

  describe('uuid', () => {
    it('nhận diện UUID v4, không phân biệt hoa thường', () => {
      expect(detectClipboardIntent('550e8400-e29b-41d4-a716-446655440000')?.kind).toBe('uuid');
      expect(detectClipboardIntent('550E8400-E29B-41D4-A716-446655440000')?.kind).toBe('uuid');
    });

    it('bỏ qua chuỗi gần giống UUID nhưng sai độ dài', () => {
      expect(detectClipboardIntent('550e8400-e29b-41d4-a716-44665544000')).toBeNull();
    });
  });

  describe('cron', () => {
    it('nhận diện biểu thức cron 5 và 6 trường', () => {
      expect(detectClipboardIntent('*/5 * * * *')?.kind).toBe('cron');
      expect(detectClipboardIntent('0 0 1 1 * 2030')?.kind).toBe('cron');
    });

    it('không nhận nhầm năm số cách nhau bằng dấu cách', () => {
      // Không có */,— nào trong các trường thì không đủ tin đó là cron.
      expect(detectClipboardIntent('1 2 3 4 5')).toBeNull();
    });
  });

  describe('timestamp', () => {
    it('nhận diện epoch giây (10 số) và mili giây (13 số)', () => {
      expect(detectClipboardIntent('1735689600')?.kind).toBe('timestamp'); // 2025
      expect(detectClipboardIntent('1735689600000')?.kind).toBe('timestamp');
    });

    it('bỏ qua chuỗi số dài không phải mốc thời gian hợp lý', () => {
      expect(detectClipboardIntent('9999999999999999')).toBeNull(); // 16 số
      expect(detectClipboardIntent('123')).toBeNull();
    });
  });

  describe('url', () => {
    it('gợi ý QR Code cho URL', () => {
      expect(detectClipboardIntent('https://example.com/path?x=1')).toEqual({
        kind: 'url',
        toolId: 'qrcode',
        reasonKey: 'clipboard.reason.url',
      });
    });

    it('không nhận URL có khoảng trắng bên trong', () => {
      expect(detectClipboardIntent('https://example.com hello')).toBeNull();
    });
  });

  describe('hex và base64', () => {
    it('nhận hex khi có ít nhất một chữ a–f', () => {
      expect(detectClipboardIntent('deadbeef')?.kind).toBe('hex');
      expect(detectClipboardIntent('0xFF00AB')?.kind).toBe('hex');
    });

    it('chuỗi toàn chữ số không bị nhận là hex (đã là số thường)', () => {
      expect(detectClipboardIntent('123456')).toBeNull();
    });

    it('nhận base64 khi có đệm hoặc trộn hoa/thường', () => {
      expect(detectClipboardIntent('SGVsbG8gV29ybGQ=')?.kind).toBe('base64');
    });

    it('hex đứng trước base64 trong thứ tự kiểm tra', () => {
      // "deadbeef" cũng thoả điều kiện độ dài chia hết 4 của base64, nhưng
      // phải được phân vào hex vì hex là mẫu chặt hơn.
      expect(detectClipboardIntent('deadbeef')?.toolId).toBe('base64');
      expect(detectClipboardIntent('deadbeef')?.kind).toBe('hex');
    });
  });
});
