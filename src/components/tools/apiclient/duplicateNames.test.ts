import { describe, expect, it } from 'vitest';
import { hasDuplicateNames } from './KeyValueEditor';
import { newKeyValue } from './types';

const row = (key: string, value = 'v', enabled = true) => ({ ...newKeyValue(key, value), enabled });

describe('hasDuplicateNames', () => {
  it('headers collide case-insensitively — the collision hardest to spot by eye', () => {
    // request.ts's buildHeaders folds these into one header (RFC 7230), so the
    // second value silently replaces the first.
    expect(hasDuplicateNames([row('Accept'), row('accept')], 'headers')).toBe(true);
    expect(hasDuplicateNames([row('Content-Type'), row('CONTENT-TYPE')], 'headers')).toBe(true);
  });

  it('query params compare exactly — different casing really is two params', () => {
    expect(hasDuplicateNames([row('id'), row('ID')], 'params')).toBe(false);
    expect(hasDuplicateNames([row('id'), row('id')], 'params')).toBe(true);
  });

  it('ignores disabled and unnamed rows', () => {
    expect(hasDuplicateNames([row('Accept'), row('accept', 'v', false)], 'headers')).toBe(false);
    expect(hasDuplicateNames([row(''), row('')], 'headers')).toBe(false);
  });

  it('no collision when every name is distinct', () => {
    expect(hasDuplicateNames([row('Accept'), row('Authorization')], 'headers')).toBe(false);
    expect(hasDuplicateNames([], 'headers')).toBe(false);
  });
});
