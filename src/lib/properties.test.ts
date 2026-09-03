import { describe, expect, it } from 'vitest';
import { parseProperties, stringifyProperties } from '@/lib/properties';

/**
 * Parser/serializer .properties tự viết tay (không dùng thư viện) — đúng loại
 * code dễ sai nhất trong cả app: escape ký tự, nối dòng bằng `\`, đường dẫn
 * key có chấm/ngoặc vuông, suy luận kiểu số/bool. Chưa có test nào trước đây.
 */

describe('parseProperties', () => {
  it('key phẳng, không lồng', () => {
    expect(parseProperties('name=DevTool\nversion=1')).toEqual({ name: 'DevTool', version: 1 });
  });

  it('key có chấm lồng thành object', () => {
    expect(parseProperties('database.host=localhost\ndatabase.port=5432'))
      .toEqual({ database: { host: 'localhost', port: 5432 } });
  });

  it('key có [n] lồng thành mảng, và mảng các object', () => {
    expect(parseProperties('servers[0].host=a\nservers[0].port=80\nservers[1].host=b\nservers[1].port=81'))
      .toEqual({ servers: [{ host: 'a', port: 80 }, { host: 'b', port: 81 }] });
  });

  it('bỏ qua dòng trống và dòng chú thích (# và !)', () => {
    expect(parseProperties('# a comment\n\n! another comment\nkey=value')).toEqual({ key: 'value' });
  });

  it('nhận cả "=" và ":" làm dấu phân cách, và khoảng trắng thuần cũng được', () => {
    expect(parseProperties('a=1\nb:2\nc 3')).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('nối dòng: một số lẻ dấu \\\\ ở cuối dòng thì dòng sau được nối vào, khoảng trắng đầu dòng sau bị cắt', () => {
    expect(parseProperties('msg=Hello \\\n    World')).toEqual({ msg: 'Hello World' });
  });

  it('một số CHẴN dấu \\\\ ở cuối dòng thì KHÔNG nối — đó là escape một dấu \\\\ thật', () => {
    // 'path=C:\\\\' trong text .properties gốc là `path=C:\\` — hai backslash =
    // một backslash thật, không phải dấu nối dòng.
    const text = 'path=C:\\\\\nnext=ok';
    expect(parseProperties(text)).toEqual({ path: 'C:\\', next: 'ok' });
  });

  it('giải mã \\n \\t \\r \\f và \\uXXXX trong cả key lẫn value', () => {
    expect(parseProperties('a\\tb=line1\\nline2')).toEqual({ 'a\tb': 'line1\nline2' });
    expect(parseProperties('smiley=\\u0041')).toEqual({ smiley: 'A' });
  });

  it('khoảng trắng thật trong key phải được escape để không bị hiểu là dấu phân cách', () => {
    expect(parseProperties('display\\ name=DevTool')).toEqual({ 'display name': 'DevTool' });
  });

  it('suy luận kiểu: true/false thành boolean, số nguyên/số thực thành number', () => {
    expect(parseProperties('a=true\nb=false\nc=42\nd=-7\ne=3.14\nf=-0.5'))
      .toEqual({ a: true, b: false, c: 42, d: -7, e: 3.14, f: -0.5 });
  });

  it('số có số 0 dẫn đầu (zip code, id) giữ nguyên dạng chuỗi', () => {
    expect(parseProperties('zip=07000')).toEqual({ zip: '07000' });
  });

  it('chuỗi không phải số/bool thì giữ nguyên chuỗi', () => {
    expect(parseProperties('env=production')).toEqual({ env: 'production' });
  });

  it('input rỗng trả về object rỗng, không phải undefined', () => {
    expect(parseProperties('')).toEqual({});
    expect(parseProperties('   \n\n  ')).toEqual({});
  });

  it('dòng chỉ có "=value" (key rỗng) bị bỏ qua', () => {
    expect(parseProperties('=orphan\nreal=value')).toEqual({ real: 'value' });
  });
});

describe('stringifyProperties', () => {
  it('object phẳng → mỗi field một dòng key=value', () => {
    expect(stringifyProperties({ name: 'DevTool', version: 1 })).toBe('name=DevTool\nversion=1');
  });

  it('object lồng → key nối bằng chấm', () => {
    expect(stringifyProperties({ database: { host: 'localhost', port: 5432 } }))
      .toBe('database.host=localhost\ndatabase.port=5432');
  });

  it('mảng → chỉ số trong ngoặc vuông', () => {
    expect(stringifyProperties({ servers: [{ host: 'a' }, { host: 'b' }] }))
      .toBe('servers[0].host=a\nservers[1].host=b');
  });

  it('escape ký tự đặc biệt trong KEY: khoảng trắng, =, :, \\\\, #, !', () => {
    const out = stringifyProperties({ 'a b': 1, 'c=d': 2, 'e:f': 3, '#g': 4 });
    expect(out).toBe('a\\ b=1\nc\\=d=2\ne\\:f=3\n\\#g=4');
  });

  it('escape ký tự đặc biệt trong VALUE: \\\\, xuống dòng, tab, và khoảng trắng dẫn đầu', () => {
    expect(stringifyProperties({ a: 'back\\slash' })).toBe('a=back\\\\slash');
    expect(stringifyProperties({ a: 'line1\nline2' })).toBe('a=line1\\nline2');
    expect(stringifyProperties({ a: 'col1\tcol2' })).toBe('a=col1\\tcol2');
    expect(stringifyProperties({ a: ' leading' })).toBe('a=\\ leading');
  });

  it('null/undefined ở lá trở thành chuỗi rỗng sau dấu =', () => {
    expect(stringifyProperties({ a: null, b: undefined })).toBe('a=\nb=');
  });

  it('root là scalar (không phải object/array) thì báo lỗi rõ ràng', () => {
    expect(() => stringifyProperties('just a string')).toThrow(/object or array/);
    expect(() => stringifyProperties(42)).toThrow(/object or array/);
    expect(() => stringifyProperties(null)).toThrow(/object or array/);
  });

  it('object rỗng → chuỗi rỗng (không dòng nào)', () => {
    expect(stringifyProperties({})).toBe('');
  });
});

describe('round-trip parse ∘ stringify', () => {
  it('cấu trúc lồng + mảng đi qua stringify rồi parse lại phải khớp nguyên trạng', () => {
    const original = {
      app: { name: 'DevTool', debug: true },
      servers: [{ host: 'a', port: 80 }, { host: 'b', port: 81 }],
    };
    expect(parseProperties(stringifyProperties(original))).toEqual(original);
  });

  it('CHUỖI SỐ bị suy luận thành number khi đọc lại — hành vi có chủ đích, không phải bug', () => {
    // Ghi "07000" (zip code) làm value CHUỖI, nhưng chỉ khi nó có số 0 dẫn đầu
    // thì đọc lại mới còn là chuỗi — value chuỗi "2024" bình thường sẽ ĐỌC LẠI
    // thành number 2024, vì .properties không có kiểu dữ liệu, chỉ có suy luận
    // theo hình dạng. Test này ghi lại ranh giới đó thay vì để ai đó "sửa" nó
    // thành round-trip hoàn hảo rồi phá vỡ suy luận kiểu ở nơi khác.
    const original = { year: '2024' };
    const reparsed = parseProperties(stringifyProperties(original)) as { year: unknown };
    expect(reparsed.year).toBe(2024);
    expect(typeof reparsed.year).toBe('number');
  });
});
