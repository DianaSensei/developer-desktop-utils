import { describe, expect, it } from 'vitest';
import { parseInput, serialize } from '@/components/tools/JsonFormatter';

/** Formatting must not change the data it formats. */
const minify = (text: string) => serialize(parseInput(text), '', '"');

describe('JSON Formatter — formatting keeps the data', () => {
  it('typographic quotes inside a string stay as they are', () => {
    expect(minify('{"text": "don’t"}')).toBe('{"text":"don’t"}');
    expect(minify('{"fr":"«Bonjour»"}')).toBe('{"fr":"«Bonjour»"}');
    expect(minify('{"quote": "He said “stop”, then left"}')).toBe('{"quote":"He said “stop”, then left"}');
  });

  it('typographic quotes used as delimiters are still accepted', () => {
    expect(minify('{“name”: “Ada”, ‘tag’: ‘x’}')).toBe('{"name":"Ada","tag":"x"}');
  });

  it('a "__proto__" key is kept as a key', () => {
    expect(minify('{"__proto__": {"admin": true}, "user": "ada"}')).toBe('{"__proto__":{"admin":true},"user":"ada"}');
  });

  it('integers beyond 2^53 and over-long decimals keep their exact digits', () => {
    expect(minify('{"id": 12345678901234567890, "id2": 9007199254740993, "ok": 42, "f": 1.5}')).toBe(
      '{"id":12345678901234567890,"id2":9007199254740993,"ok":42,"f":1.5}',
    );
    expect(minify('[0.12345678901234567890123, 1e999]')).toBe('[0.12345678901234567890123,1e999]');
  });

  it('a lenient leading + is dropped so the output is valid JSON', () => {
    expect(minify('{a: +5}')).toBe('{"a":5}');
  });
});
