import { describe, expect, it } from 'vitest';
import { parseProperties, stringifyProperties } from '@/lib/properties';

/**
 * The hand-written .properties parser/serializer: escapes, line
 * continuations, dotted/bracketed key paths, and number/boolean inference.
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
    // 'path=C:\\\\' in the file is `path=C:\\`: an escaped backslash, not a
    // line continuation.
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
    // .properties has no types, so values are inferred from their shape:
    // "2024" reads back as a number, while "07000" (leading zero) stays a
    // string. Documented here so a "fix" does not break inference.
    const original = { year: '2024' };
    const reparsed = parseProperties(stringifyProperties(original)) as { year: unknown };
    expect(reparsed.year).toBe(2024);
    expect(typeof reparsed.year).toBe('number');
  });
});

describe('parseProperties — values and keys are kept as written', () => {
  it('a __proto__ / constructor key is plain data and never touches Object.prototype', () => {
    const parsed = parseProperties('__proto__.polluted=yes\nconstructor.prototype.p2=yes\na=1') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).p2).toBeUndefined();
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(
      JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":"yes"}},"a":1}'),
    );
  });

  it('numbers that would not print back the same stay strings', () => {
    expect(parseProperties('version=1.10\nrate=1.0\nhalf=.5\nzip=07000\nn=3.25')).toEqual({
      version: '1.10',
      rate: '1.0',
      half: '.5',
      zip: '07000',
      n: 3.25,
    });
  });

  it('Spring logging levels: a key that is both a value and a prefix keeps every line', () => {
    const text = 'logging.level.com.example=DEBUG\nlogging.level.com.example.service=TRACE';
    expect(parseProperties(text)).toEqual({
      logging: { level: { com: { example: 'DEBUG', 'example.service': 'TRACE' } } },
    });
    const reversed = 'logging.level.com.example.service=TRACE\nlogging.level.com.example=DEBUG';
    expect(parseProperties(reversed)).toEqual({
      logging: { level: { com: { example: 'DEBUG', 'example.service': 'TRACE' } } },
    });
    expect(stringifyProperties(parseProperties(text)).split('\n').sort()).toEqual(text.split('\n').sort());
  });
});
