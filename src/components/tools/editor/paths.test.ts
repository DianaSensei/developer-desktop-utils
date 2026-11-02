import { describe, expect, it } from 'vitest';
import { basename, dirname, extname, isUnder, join, rebase, relativeTo, sepOf } from './paths';

describe('editor paths — POSIX', () => {
  it('splits names and parents', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('/a/b/')).toBe('b');
    expect(dirname('/a/b/c.txt')).toBe('/a/b');
    expect(dirname('/a')).toBe('/');
    expect(join('/a', 'b')).toBe('/a/b');
    expect(join('/', 'b')).toBe('/b');
  });

  it('isUnder is component-wise, not a string prefix', () => {
    expect(isUnder('/ws/a.txt', '/ws')).toBe(true);
    expect(isUnder('/ws', '/ws')).toBe(true);
    expect(isUnder('/ws-evil/a.txt', '/ws')).toBe(false);
  });

  it('rebases descendants of a renamed folder only', () => {
    expect(rebase('/ws/old/x.ts', '/ws/old', '/ws/new')).toBe('/ws/new/x.ts');
    expect(rebase('/ws/old', '/ws/old', '/ws/new')).toBe('/ws/new');
    expect(rebase('/ws/older/x.ts', '/ws/old', '/ws/new')).toBe('/ws/older/x.ts');
  });

  it('relative paths and extensions', () => {
    expect(relativeTo('/ws/src/a.ts', '/ws')).toBe('src/a.ts');
    expect(relativeTo('/ws', '/ws')).toBe('');
    expect(extname('/a/b.TS')).toBe('ts');
    expect(extname('/a/.env')).toBe('env');
    expect(extname('/a/Makefile')).toBe('');
  });
});

describe('editor paths — Windows', () => {
  it('detects the separator and keeps drive roots', () => {
    expect(sepOf('C:\\Users\\me')).toBe('\\');
    expect(basename('C:\\Users\\me\\a.txt')).toBe('a.txt');
    expect(dirname('C:\\Users\\me\\a.txt')).toBe('C:\\Users\\me');
    expect(dirname('C:\\a.txt')).toBe('C:\\');
    expect(join('C:\\ws', 'a.txt')).toBe('C:\\ws\\a.txt');
  });

  it('relative paths come back /-separated', () => {
    expect(relativeTo('C:\\ws\\src\\a.ts', 'C:\\ws')).toBe('src/a.ts');
    expect(isUnder('C:\\ws2\\a', 'C:\\ws')).toBe(false);
  });
});
