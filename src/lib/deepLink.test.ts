import { describe, expect, it } from 'vitest';
import { parseInstallUrls } from '@/lib/deepLink';

describe('parseInstallUrls', () => {
  it('lấy cả manifest và service từ một link devtool://install hợp lệ', () => {
    expect(parseInstallUrls('devtool://install?manifest=https://a/p.json&service=https://a/s.json')).toEqual([
      'https://a/p.json',
      'https://a/s.json',
    ]);
  });

  it('chỉ có manifest, không có service — vẫn nhận, không thêm phần tử rỗng', () => {
    expect(parseInstallUrls('devtool://install?manifest=https://a/p.json')).toEqual(['https://a/p.json']);
  });

  it('chỉ có service, không có manifest — vẫn nhận (chuỗi cài đặt hai bước)', () => {
    expect(parseInstallUrls('devtool://install?service=https://a/s.json')).toEqual(['https://a/s.json']);
  });

  it('không phải scheme devtool: — bỏ qua', () => {
    expect(parseInstallUrls('https://install?manifest=https://a/p.json')).toEqual([]);
  });

  it('đúng scheme devtool: nhưng sai host (không phải "install") — bỏ qua', () => {
    expect(parseInstallUrls('devtool://uninstall?manifest=https://a/p.json')).toEqual([]);
  });

  it('không có tham số nào cả — trả về rỗng', () => {
    expect(parseInstallUrls('devtool://install')).toEqual([]);
  });

  it('chuỗi không parse được thành URL — không ném lỗi, trả về rỗng', () => {
    expect(parseInstallUrls('not a url')).toEqual([]);
  });

  it('một CLI argument không liên quan (không phải devtool://) — bỏ qua im lặng', () => {
    expect(parseInstallUrls('--some-flag')).toEqual([]);
  });
});
