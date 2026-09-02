import { describe, expect, it } from 'vitest';
import { queryJson } from './jsonpath';

const data = {
  store: {
    book: [
      { title: 'Dune', price: 12.5, tags: ['sf', 'classic'] },
      { title: 'Neuromancer', price: 9.99, tags: ['sf'] },
    ],
    open: true,
  },
};

describe('queryJson', () => {
  it('walks keys, indexes and the root', () => {
    expect(queryJson(data, '$')).toEqual(data);
    expect(queryJson(data, '$.store.open')).toBe(true);
    expect(queryJson(data, '$.store.book[0].title')).toBe('Dune');
    expect(queryJson(data, "$.store.book[1]['title']")).toBe('Neuromancer');
  });

  it('supports negative indexes and out-of-range', () => {
    expect(queryJson(data, '$.store.book[-1].title')).toBe('Neuromancer');
    expect(queryJson(data, '$.store.book[9]')).toEqual([]);
  });

  it('wildcards and recursive descent collect every match', () => {
    expect(queryJson(data, '$.store.book[*].title')).toEqual(['Dune', 'Neuromancer']);
    expect(queryJson(data, '$..price')).toEqual([12.5, 9.99]);
  });

  it('an array length is an own property, so it still answers with the count', () => {
    expect(queryJson(data, '$.store.book.length')).toBe(2);
  });

  it('never reaches through the prototype chain', () => {
    // `in` matched every Object.prototype member, so these returned functions.
    expect(queryJson(data, '$.constructor')).toEqual([]);
    expect(queryJson(data, '$.store.toString')).toEqual([]);
    expect(queryJson(data, '$.store.book[0].hasOwnProperty')).toEqual([]);
  });

  it('a missing key yields no match', () => {
    expect(queryJson(data, '$.store.missing')).toEqual([]);
  });
});
