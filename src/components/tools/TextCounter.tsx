import { useDeferredValue, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
import { Check, X } from 'lucide-react';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function TextCounter() {
  const [text, setText] = usePersistentState('devtool:textCounter:text', '');

  // The stats below do several full-string scans (splits, TextEncoder, per-char
  // counts). Defer so the textarea stays responsive on large input.
  const deferredText = useDeferredValue(text);

  const stats = useMemo(() => {
    const text = deferredText;
    const empty = {
      characters: 0,
      charactersNoSpaces: 0,
      words: 0,
      lines: 0,
      paragraphs: 0,
      sentences: 0,
      readingTime: 0,
      codePoints: 0,
      utf8Bytes: 0,
      utf16Bytes: 0,
      utf32Bytes: 0,
      asciiChars: 0,
      latin1Chars: 0,
      bmpChars: 0,
      astralChars: 0,
      fitsAscii: true,
      fitsLatin1: true,
    };

    if (!text) {
      return empty;
    }

    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;

    // Word count - split by whitespace and filter empty strings
    const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;

    // Line count - split by newlines
    const lines = text.split('\n').length;

    // Paragraph count - split by double newlines or more
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

    // Sentence count - split by sentence terminators
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

    // Reading time estimate (avg 200 words per minute)
    const readingTime = Math.ceil(words / 200);

    // Code points (handles emoji/surrogate pairs as a single character)
    const codePointArray = Array.from(text);
    const codePoints = codePointArray.length;

    // Byte sizes per encoding
    const utf8Bytes = new TextEncoder().encode(text).length; // variable-width, 1-4 bytes
    const utf16Bytes = characters * 2; // each UTF-16 code unit is 2 bytes
    const utf32Bytes = codePoints * 4; // each code point is 4 bytes

    // Character composition by Unicode range
    let asciiChars = 0;
    let latin1Chars = 0;
    let bmpChars = 0;
    let astralChars = 0;
    for (const ch of codePointArray) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp <= 0x7f) asciiChars++;
      else if (cp <= 0xff) latin1Chars++;
      else if (cp <= 0xffff) bmpChars++;
      else astralChars++;
    }

    const fitsAscii = latin1Chars === 0 && bmpChars === 0 && astralChars === 0;
    const fitsLatin1 = bmpChars === 0 && astralChars === 0;

    return {
      characters,
      charactersNoSpaces,
      words,
      lines,
      paragraphs,
      sentences,
      readingTime,
      codePoints,
      utf8Bytes,
      utf16Bytes,
      utf32Bytes,
      asciiChars,
      latin1Chars,
      bmpChars,
      astralChars,
      fitsAscii,
      fitsLatin1,
    };
  }, [deferredText]);

  const smallestEncoding = !text
    ? '—'
    : stats.fitsAscii
      ? 'ASCII (7-bit)'
      : stats.fitsLatin1
        ? 'Latin-1 (ISO-8859-1)'
        : stats.astralChars > 0
          ? 'Unicode (incl. supplementary)'
          : 'Unicode (BMP)';

  const encodingSupport = [
    { name: 'ASCII', detail: '7-bit, 1 byte/char', fits: stats.fitsAscii },
    { name: 'Latin-1 (ISO-8859-1)', detail: '8-bit, 1 byte/char', fits: stats.fitsLatin1 },
    { name: 'UTF-8', detail: `${stats.utf8Bytes} bytes`, fits: true },
    { name: 'UTF-16', detail: `${stats.utf16Bytes} bytes`, fits: true },
    { name: 'UTF-32', detail: `${stats.utf32Bytes} bytes`, fits: true },
  ];

  useQuickPaste((pasted) => setText(pasted));
  useInputHistory(text, setText);

  const Stat = ({ label, value, color = 'text-foreground' }: { label: string; value: number | string; color?: string }) => (
    <div className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-card/50 hover:bg-card/80 transition-colors">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1 text-center leading-tight">{label}</div>
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: textarea input */}
      <div className="flex flex-col min-h-0 border-r" style={{ width: '40%' }}>
        <PaneHeader label="Text Input" hint={quickPasteHint} />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type or paste your text here..."
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Right: stats scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Characters" value={stats.characters} color="text-blue-600 dark:text-blue-400" />
          <Stat label="No spaces" value={stats.charactersNoSpaces} color="text-purple-600 dark:text-purple-400" />
          <Stat label="Words" value={stats.words} color="text-green-600 dark:text-green-400" />
          <Stat label="Lines" value={stats.lines} color="text-orange-600 dark:text-orange-400" />
          <Stat label="Paragraphs" value={stats.paragraphs} color="text-pink-600 dark:text-pink-400" />
          <Stat label="Sentences" value={stats.sentences} color="text-cyan-600 dark:text-cyan-400" />
          <Stat label="Reading time" value={`${stats.readingTime} min`} color="text-indigo-600 dark:text-indigo-400" />
          <Stat label="Avg word length" value={stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(1) : '0'} color="text-teal-600 dark:text-teal-400" />
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Byte Size</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Stat label="UTF-8 bytes" value={stats.utf8Bytes} color="text-blue-600 dark:text-blue-400" />
            <Stat label="UTF-16 bytes" value={stats.utf16Bytes} color="text-purple-600 dark:text-purple-400" />
            <Stat label="UTF-32 bytes" value={stats.utf32Bytes} color="text-pink-600 dark:text-pink-400" />
            <Stat label="Code points" value={stats.codePoints} color="text-green-600 dark:text-green-400" />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Smallest encoding: <span className="font-mono text-foreground">{smallestEncoding}</span>
          </p>
          <ul className="space-y-1.5 text-sm">
            {encodingSupport.map((enc) => (
              <li key={enc.name} className="flex items-center gap-2">
                {enc.fits ? (
                  <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className={enc.fits ? 'text-foreground text-xs' : 'text-muted-foreground line-through text-xs'}>{enc.name}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{enc.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-semibold text-sm mb-2">Text Details</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>Spaces: <span className="font-mono text-foreground">{stats.characters - stats.charactersNoSpaces}</span></li>
              <li>Avg chars/word: <span className="font-mono text-foreground">{stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(2) : 0}</span></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sm mb-2">Character Composition</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>ASCII (U+0000–U+007F): <span className="font-mono text-foreground">{stats.asciiChars}</span></li>
              <li>Latin-1 (U+0080–U+00FF): <span className="font-mono text-foreground">{stats.latin1Chars}</span></li>
              <li>BMP (U+0100–U+FFFF): <span className="font-mono text-foreground">{stats.bmpChars}</span></li>
              <li>Supplementary (U+10000+): <span className="font-mono text-foreground">{stats.astralChars}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
