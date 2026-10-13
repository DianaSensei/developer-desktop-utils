import { describe, expect, it } from 'vitest';
import { computeTextStats } from '@/lib/textStats';

/** The one-pass counter must agree with the original multi-scan version. */
function reference(text: string) {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const codePointArray = Array.from(text);
  let ascii = 0, latin1 = 0, bmp = 0, astral = 0;
  for (const ch of codePointArray) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) ascii++; else if (cp <= 0xff) latin1++; else if (cp <= 0xffff) bmp++; else astral++;
  }
  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    words,
    lines: text.split('\n').length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    sentences: text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length,
    readingTime: words / 200,
    codePoints: codePointArray.length,
    utf8Bytes: new TextEncoder().encode(text).length,
    utf16Bytes: text.length * 2,
    utf32Bytes: codePointArray.length * 4,
    asciiChars: ascii, latin1Chars: latin1, bmpChars: bmp, astralChars: astral,
    fitsAscii: latin1 === 0 && bmp === 0 && astral === 0,
    fitsLatin1: bmp === 0 && astral === 0,
  };
}

const ALPHABET = ['a', 'b', 'Z', '1', ' ', ' ', '\n', '\n', '\t', '\r', '.', '!', '?', '…', 'é', 'ữ', '中',
  '😀', '👍🏽', ' ', ' ', '　', '﻿', '\ud800', '\udc00', ',', '-'];

function randomText(seed: number, len: number) {
  let x = seed;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += ALPHABET[x % ALPHABET.length];
  }
  return out;
}

describe('computeTextStats', () => {
  it('is all zeros for empty text', () => {
    const s = computeTextStats('');
    expect([s.characters, s.words, s.lines, s.paragraphs, s.sentences, s.codePoints]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each([
    'Hello world. How are you?',
    'one\n\ntwo\n \n three',
    '  leading and trailing  \n',
    'Wait... what?! Really.',
    'Tiếng Việt có dấu: ữ ộ ế.',
    'emoji 😀😀 and 👍🏽!',
    'lone \ud800 surrogate',
  ])('matches the reference for %j', (text) => {
    expect(computeTextStats(text)).toEqual(reference(text));
  });

  it('matches the reference on 300 random strings', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const text = randomText(seed, 1 + (seed % 120));
      expect(computeTextStats(text), JSON.stringify(text)).toEqual(reference(text));
    }
  });
});
