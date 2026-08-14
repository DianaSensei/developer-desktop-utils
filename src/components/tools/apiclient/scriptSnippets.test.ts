import { describe, expect, it } from 'vitest';
import { appendSnippet, POST_RESPONSE_SNIPPETS, PRE_REQUEST_SNIPPETS } from './scriptSnippets';

describe('appendSnippet', () => {
  it('uses the snippet as-is when the script is empty', () => {
    expect(appendSnippet('', PRE_REQUEST_SNIPPETS[0])).toBe(PRE_REQUEST_SNIPPETS[0].code);
    expect(appendSnippet('   \n  ', PRE_REQUEST_SNIPPETS[0])).toBe(PRE_REQUEST_SNIPPETS[0].code);
  });

  it('appends with a blank line separator when the script already has content', () => {
    const out = appendSnippet('bru.setVar("a", 1);', POST_RESPONSE_SNIPPETS[0]);
    expect(out).toBe(`bru.setVar("a", 1);\n\n${POST_RESPONSE_SNIPPETS[0].code}`);
  });
});

describe('snippet lists', () => {
  it('every snippet has a non-empty label and code', () => {
    for (const list of [PRE_REQUEST_SNIPPETS, POST_RESPONSE_SNIPPETS]) {
      for (const s of list) {
        expect(s.label.trim()).not.toBe('');
        expect(s.code.trim()).not.toBe('');
      }
    }
  });

  it('labels within a list are unique (used as React keys)', () => {
    for (const list of [PRE_REQUEST_SNIPPETS, POST_RESPONSE_SNIPPETS]) {
      const labels = list.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
