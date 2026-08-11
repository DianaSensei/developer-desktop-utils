import { describe, expect, it } from 'vitest';
import { dataColumns, parseDataFile, sniffDelimiter } from './datafile';

describe('sniffDelimiter', () => {
  it('defaults to comma', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('detects semicolons (Excel in comma-decimal locales)', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('detects tabs', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('ignores delimiters inside quoted headers', () => {
    // The quoted header contains semicolons, but the real separator is a comma.
    expect(sniffDelimiter('"a;b;c;d",second\n1,2')).toBe(',');
  });

  it('only looks at the header line', () => {
    expect(sniffDelimiter('a,b\n1;2;3;4;5')).toBe(',');
  });
});

describe('parseDataFile — CSV', () => {
  it('maps the header row to variables', () => {
    const out = parseDataFile('users.csv', 'name,email\nAda,ada@test\nGrace,grace@test');
    expect(out.format).toBe('csv');
    expect(out.delimiter).toBe(',');
    expect(out.columns).toEqual(['name', 'email']);
    expect(out.rows).toEqual([
      { name: 'Ada', email: 'ada@test' },
      { name: 'Grace', email: 'grace@test' },
    ]);
  });

  it('strips a UTF-8 BOM so the first column is usable', () => {
    // Excel writes this; left in place the first variable becomes "﻿id".
    const out = parseDataFile('x.csv', '﻿id,name\n1,Ada');
    expect(out.columns).toEqual(['id', 'name']);
    expect(out.rows[0].id).toBe('1');
  });

  it('parses semicolon-separated files', () => {
    const out = parseDataFile('x.csv', 'id;name\n1;Ada');
    expect(out.delimiter).toBe(';');
    expect(out.rows).toEqual([{ id: '1', name: 'Ada' }]);
  });

  it('parses tab-separated files', () => {
    const out = parseDataFile('x.csv', 'id\tname\n1\tAda');
    expect(out.delimiter).toBe('\t');
    expect(out.rows).toEqual([{ id: '1', name: 'Ada' }]);
  });

  it('handles quoted fields with embedded delimiters, quotes and newlines', () => {
    const csv = 'id,note\n1,"a,b"\n2,"she said ""hi"""\n3,"line1\nline2"';
    const out = parseDataFile('x.csv', csv);
    expect(out.rows.map((r) => r.note)).toEqual(['a,b', 'she said "hi"', 'line1\nline2']);
  });

  it('handles CRLF line endings', () => {
    const out = parseDataFile('x.csv', 'id,name\r\n1,Ada\r\n2,Grace\r\n');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]).toEqual({ id: '2', name: 'Grace' });
  });

  it('pads rows that are missing trailing columns', () => {
    const out = parseDataFile('x.csv', 'a,b,c\n1,2');
    expect(out.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('ignores blank lines', () => {
    const out = parseDataFile('x.csv', 'a\n1\n\n2\n');
    expect(out.rows).toEqual([{ a: '1' }, { a: '2' }]);
  });

  it('skips columns with an empty header', () => {
    const out = parseDataFile('x.csv', 'a,,c\n1,2,3');
    expect(out.columns).toEqual(['a', 'c']);
  });

  it('rejects a file with only a header', () => {
    expect(() => parseDataFile('x.csv', 'a,b')).toThrow(/No data rows/);
  });
});

describe('parseDataFile — JSON', () => {
  it('parses an array of objects', () => {
    const out = parseDataFile('x.json', '[{"id":1,"ok":true},{"id":2,"ok":false}]');
    expect(out.format).toBe('json');
    expect(out.rows).toEqual([{ id: '1', ok: 'true' }, { id: '2', ok: 'false' }]);
  });

  it('accepts a single object as one row', () => {
    const out = parseDataFile('x.json', '{"id":1}');
    expect(out.rows).toEqual([{ id: '1' }]);
  });

  it('stringifies nested values so they still interpolate', () => {
    const out = parseDataFile('x.json', '[{"tags":["a","b"],"meta":{"k":1}}]');
    expect(out.rows[0].tags).toBe('["a","b"]');
    expect(out.rows[0].meta).toBe('{"k":1}');
  });

  it('sniffs JSON content even with a .csv name', () => {
    expect(parseDataFile('mislabelled.csv', '[{"a":1}]').format).toBe('json');
  });

  it('reports malformed JSON', () => {
    expect(() => parseDataFile('x.json', '[{')).toThrow(/Couldn't parse JSON/);
  });
});

describe('dataColumns', () => {
  it('unions keys across rows in first-seen order', () => {
    expect(dataColumns([{ a: '1' }, { b: '2' }, { a: '3', c: '4' }])).toEqual(['a', 'b', 'c']);
  });
});
