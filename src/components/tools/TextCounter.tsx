import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Check, FileText, X } from 'lucide-react';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function TextCounter() {
  const [text, setText] = usePersistentState('devtool:textCounter:text', '');

  const stats = useMemo(() => {
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
  }, [text]);

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

  const StatCard = ({ label, value, color = 'text-foreground' }: { label: string; value: number | string; color?: string }) => (
    <div className="flex flex-col items-center justify-center p-4 rounded-lg border bg-card">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Word & Character Counter
          </CardTitle>
          <CardDescription>Count words, characters, lines, and more</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Text Input</Label>
              <span className="text-xs text-muted-foreground">{quickPasteHint}</span>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste your text here..."
              className="min-h-[300px] font-mono text-sm resize-y"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Characters" value={stats.characters} color="text-blue-600 dark:text-blue-400" />
        <StatCard label="Characters (no spaces)" value={stats.charactersNoSpaces} color="text-purple-600 dark:text-purple-400" />
        <StatCard label="Words" value={stats.words} color="text-green-600 dark:text-green-400" />
        <StatCard label="Lines" value={stats.lines} color="text-orange-600 dark:text-orange-400" />
        <StatCard label="Paragraphs" value={stats.paragraphs} color="text-pink-600 dark:text-pink-400" />
        <StatCard label="Sentences" value={stats.sentences} color="text-cyan-600 dark:text-cyan-400" />
        <StatCard label="Reading Time" value={`${stats.readingTime} min`} color="text-indigo-600 dark:text-indigo-400" />
        <StatCard
          label="Avg Word Length"
          value={stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(1) : 0}
          color="text-teal-600 dark:text-teal-400"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Byte Size & Encoding</CardTitle>
          <CardDescription>
            Check byte length per encoding to confirm the text fits a database column (e.g. VARCHAR sized in bytes)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard label="UTF-8 bytes" value={stats.utf8Bytes} color="text-blue-600 dark:text-blue-400" />
            <StatCard label="UTF-16 bytes" value={stats.utf16Bytes} color="text-purple-600 dark:text-purple-400" />
            <StatCard label="UTF-32 bytes" value={stats.utf32Bytes} color="text-pink-600 dark:text-pink-400" />
            <StatCard label="Code points" value={stats.codePoints} color="text-green-600 dark:text-green-400" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">Encoding compatibility</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Smallest encoding that fits: <span className="font-mono text-foreground">{smallestEncoding}</span>
              </p>
              <ul className="space-y-1.5">
                {encodingSupport.map((enc) => (
                  <li key={enc.name} className="flex items-center gap-2">
                    {enc.fits ? (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className={enc.fits ? 'text-foreground' : 'text-muted-foreground line-through'}>
                      {enc.name}
                    </span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{enc.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Character composition</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li>• ASCII (U+0000–U+007F): <span className="font-mono text-foreground">{stats.asciiChars}</span></li>
                <li>• Latin-1 supplement (U+0080–U+00FF): <span className="font-mono text-foreground">{stats.latin1Chars}</span></li>
                <li>• Other BMP (U+0100–U+FFFF): <span className="font-mono text-foreground">{stats.bmpChars}</span></li>
                <li>• Supplementary / emoji (U+10000+): <span className="font-mono text-foreground">{stats.astralChars}</span></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">Text Details</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Total characters: <span className="font-mono text-foreground">{stats.characters}</span></li>
                <li>• Without spaces: <span className="font-mono text-foreground">{stats.charactersNoSpaces}</span></li>
                <li>• Spaces: <span className="font-mono text-foreground">{stats.characters - stats.charactersNoSpaces}</span></li>
                <li>• Average chars per word: <span className="font-mono text-foreground">{stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(2) : 0}</span></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Structure</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Words per sentence: <span className="font-mono text-foreground">{stats.sentences > 0 ? (stats.words / stats.sentences).toFixed(1) : 0}</span></li>
                <li>• Sentences per paragraph: <span className="font-mono text-foreground">{stats.paragraphs > 0 ? (stats.sentences / stats.paragraphs).toFixed(1) : 0}</span></li>
                <li>• Lines per paragraph: <span className="font-mono text-foreground">{stats.paragraphs > 0 ? (stats.lines / stats.paragraphs).toFixed(1) : 0}</span></li>
                <li>• Reading time (200 wpm): <span className="font-mono text-foreground">{stats.readingTime} {stats.readingTime === 1 ? 'minute' : 'minutes'}</span></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
