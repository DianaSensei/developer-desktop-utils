import { describe, expect, it } from 'vitest';
import { formatMongo, formatSQL } from '@/components/tools/SqlFormatter';

const OPTS = { indentSize: 2, uppercaseKeywords: true, collapseSpaces: true, lineBreaks: true };

describe('SQL formatter — never changes what the query means', () => {
  it('identifiers that contain keywords are left whole', () => {
    expect(formatSQL('select color, vendor, brand, description, date_from, is_on from products where region = 1', OPTS)).toBe(
      'SELECT color, vendor, brand, description, date_from, is_on\nFROM products\nWHERE region = 1',
    );
  });

  it('still breaks real clauses and conditions', () => {
    expect(formatSQL('select a from t where x = 1 and y = 2 or z = 3', OPTS)).toBe(
      'SELECT a\nFROM t\nWHERE x = 1\n  AND y = 2\n  OR z = 3',
    );
  });

  it('a -- comment ends at its line; the next line stays code', () => {
    const out = formatSQL('SELECT a, -- the a column\n  b\nFROM t', OPTS);
    expect(out).toContain('-- the a column\n');
    expect(out.split('\n').some((line) => !line.includes('--') && line.includes('b'))).toBe(true);
  });

  it('a $$ function body is not reformatted', () => {
    const out = formatSQL('create function f() returns int as $$ select 1 from dual $$ language sql', OPTS);
    expect(out).toContain('$$ select 1 from dual $$');
  });

  it('Mongo: a // comment does not swallow the next statement', () => {
    const out = formatMongo('db.c.find({u:"http://x"}) // comment, here\ndb.c.count()', 2);
    expect(out).toContain('// comment, here\n');
    expect(out).toMatch(/\ndb\.c\.count\(\)/);
  });
});
