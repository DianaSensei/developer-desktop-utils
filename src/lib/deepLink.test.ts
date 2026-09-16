import { describe, expect, it } from 'vitest';
import { parseInstallUrls } from '@/lib/deepLink';

describe('parseInstallUrls', () => {
  it.each<[string, string, string[]]>([
    [
      'lấy cả manifest và service từ một link desktop-devtool-app://install hợp lệ',
      'desktop-devtool-app://install?manifest=https://a/p.json&service=https://a/s.json',
      ['https://a/p.json', 'https://a/s.json'],
    ],
    [
      'chỉ có manifest, không có service — vẫn nhận, không thêm phần tử rỗng',
      'desktop-devtool-app://install?manifest=https://a/p.json',
      ['https://a/p.json'],
    ],
    [
      'chỉ có service, không có manifest — vẫn nhận (chuỗi cài đặt hai bước)',
      'desktop-devtool-app://install?service=https://a/s.json',
      ['https://a/s.json'],
    ],
    ['không phải scheme desktop-devtool-app: — bỏ qua', 'https://install?manifest=https://a/p.json', []],
    [
      'đúng scheme desktop-devtool-app: nhưng sai host (không phải "install") — bỏ qua',
      'desktop-devtool-app://uninstall?manifest=https://a/p.json',
      [],
    ],
    ['không có tham số nào cả — trả về rỗng', 'desktop-devtool-app://install', []],
    ['chuỗi không parse được thành URL — không ném lỗi, trả về rỗng', 'not a url', []],
    ['một CLI argument không liên quan (không phải desktop-devtool-app://) — bỏ qua im lặng', '--some-flag', []],
  ])('%s', (_label, input, expected) => {
    expect(parseInstallUrls(input)).toEqual(expected);
  });
});
