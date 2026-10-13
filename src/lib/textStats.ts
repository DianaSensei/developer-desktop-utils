// Text Counter statistics in one pass over the UTF-16 code units.
//
// The first version did ~8 full scans (several regex splits, Array.from,
// TextEncoder) and blocked the main thread ~1.8s on a 2.5 MB paste. Counts
// here match that version exactly (textStats.test.ts compares the two).

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
  sentences: number;
  readingTime: number;
  codePoints: number;
  utf8Bytes: number;
  utf16Bytes: number;
  utf32Bytes: number;
  asciiChars: number;
  latin1Chars: number;
  bmpChars: number;
  astralChars: number;
  fitsAscii: boolean;
  fitsLatin1: boolean;
}

/** JavaScript's `\s`, by UTF-16 code unit. */
export function isJsWhitespace(c: number): boolean {
  if (c <= 0x20) return c === 0x20 || (c >= 0x09 && c <= 0x0d);
  if (c < 0xa0) return false;
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
    || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f
    || c === 0x3000 || c === 0xfeff;
}

/** Words per minute for the reading-time estimate. */
const WPM = 200;

export function computeTextStats(text: string): TextStats {
  const n = text.length;
  let spaces = 0;
  let words = 0;
  let lines = 1;
  let paragraphs = 0;
  let sentences = 0;
  let codePoints = 0;
  let utf8Bytes = 0;
  let ascii = 0;
  let latin1 = 0;
  let bmp = 0;
  let astral = 0;

  let inWord = false;
  let sawContent = false;          // any non-whitespace yet (paragraphs)
  let newlinesInGap = 0;           // '\n' in the current whitespace run
  let sentenceHasContent = false;

  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);

    // Code points, encodings and Unicode ranges.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        // A surrogate pair: one astral code point, two code units, no
        // whitespace or punctuation, so the text counters see one char.
        codePoints++;
        utf8Bytes += 4;
        astral++;
        if (!inWord) { words++; inWord = true; }
        if (!sawContent || newlinesInGap >= 2) paragraphs++;
        sawContent = true;
        newlinesInGap = 0;
        sentenceHasContent = true;
        i++;
        continue;
      }
    }
    codePoints++;
    if (c < 0x80) { utf8Bytes += 1; ascii++; }
    else if (c < 0x800) { utf8Bytes += 2; if (c <= 0xff) latin1++; else bmp++; }
    else { utf8Bytes += 3; bmp++; }   // includes lone surrogates (U+FFFD, 3 bytes)

    if (c === 0x0a) lines++;

    if (isJsWhitespace(c)) {
      spaces++;
      inWord = false;
      if (c === 0x0a) newlinesInGap++;
      continue;
    }
    if (!inWord) { words++; inWord = true; }
    if (!sawContent || newlinesInGap >= 2) paragraphs++;
    sawContent = true;
    newlinesInGap = 0;

    if (c === 0x2e || c === 0x21 || c === 0x3f) {   // . ! ?
      if (sentenceHasContent) sentences++;
      sentenceHasContent = false;
    } else {
      sentenceHasContent = true;
    }
  }
  if (sentenceHasContent) sentences++;

  if (n === 0) lines = 0;

  return {
    characters: n,
    charactersNoSpaces: n - spaces,
    words,
    lines,
    paragraphs,
    sentences,
    readingTime: words / WPM,
    codePoints,
    utf8Bytes,
    utf16Bytes: n * 2,
    utf32Bytes: codePoints * 4,
    asciiChars: ascii,
    latin1Chars: latin1,
    bmpChars: bmp,
    astralChars: astral,
    fitsAscii: latin1 === 0 && bmp === 0 && astral === 0,
    fitsLatin1: bmp === 0 && astral === 0,
  };
}
