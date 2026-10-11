import { useDeferredValue, useMemo } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Check, X } from 'lucide-react';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/TextCounter.messages';

// 200 từ/phút. Làm tròn LÊN như trước khiến 1 từ cũng thành "1 min" — dưới
// một phút thì nói đúng là dưới một phút.
function formatReadingTime(minutes: number, m: (k: 'minutes' | 'underMinute', p?: { n: number }) => string) {
  if (minutes === 0) return m('minutes', { n: 0 });
  if (minutes < 1) return m('underMinute');
  return m('minutes', { n: Math.round(minutes) });
}

export function TextCounter() {
  const sdk = usePluginSdkFor('text-counter');
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const [text, setText] = usePluginState(sdk, 'textCounter:text', '', { legacyKey: 'devtool:textCounter:text' });

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
    const readingTime = words / 200;

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
          ? m('unicodeSupplementary')
          : 'Unicode (BMP)';

  const encodingSupport = [
    { name: 'ASCII', detail: m('bytesPerChar7'), fits: stats.fitsAscii },
    { name: 'Latin-1 (ISO-8859-1)', detail: m('bytesPerChar8'), fits: stats.fitsLatin1 },
    { name: 'UTF-8', detail: m('bytes', { n: stats.utf8Bytes }), fits: true },
    { name: 'UTF-16', detail: m('bytes', { n: stats.utf16Bytes }), fits: true },
    { name: 'UTF-32', detail: m('bytes', { n: stats.utf32Bytes }), fits: true },
  ];

  useQuickPaste((pasted) => setText(pasted));
  useInputHistory(text, setText);

  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      {/* Left (top on narrow windows): textarea input */}
      <div className="flex h-2/5 min-h-0 shrink-0 flex-col border-b border-line md:h-auto md:w-2/5 md:border-b-0 md:border-r">
        <PaneHeader label={m('textInput')} hint={quickPasteHint} />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={m('placeholder')}
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Right: stats scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/*
          Bản cũ tô mỗi ô một màu cầu vồng (xanh dương/tím/xanh lá/cam/hồng…) dù
          không ô nào mang NGHĨA khác ô nào — "Characters" không "đúng" hơn
          "Words". Màu trang trí kiểu đó là đúng thứ design/RULES.md cấm: màu
          phải mang nghĩa trạng thái/tương tác. Tất cả về `tone="default"`.
        */}
        <StatGrid columns={4}>
          <Stat variant="compact" label={m('characters')} value={stats.characters} />
          <Stat variant="compact" label={m('noSpaces')} value={stats.charactersNoSpaces} />
          <Stat variant="compact" label={m('words')} value={stats.words} />
          <Stat variant="compact" label={m('lines')} value={stats.lines} />
          <Stat variant="compact" label={m('paragraphs')} value={stats.paragraphs} />
          <Stat variant="compact" label={m('sentences')} value={stats.sentences} />
          <Stat variant="compact" label={m('readingTime')} value={formatReadingTime(stats.readingTime, m)} />
          <Stat
            variant="compact"
            label={m('avgWordLength')}
            value={stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(1) : '0'}
          />
        </StatGrid>

        <div className="border-t border-line pt-4">
          <p className="text-xs font-semibold text-fg-mute uppercase tracking-wider mb-3">{m('byteSize')}</p>
          <StatGrid columns={4} className="mb-4">
            <Stat variant="compact" label={m('utf8Bytes')} value={stats.utf8Bytes} />
            <Stat variant="compact" label={m('utf16Bytes')} value={stats.utf16Bytes} />
            <Stat variant="compact" label={m('utf32Bytes')} value={stats.utf32Bytes} />
            <Stat variant="compact" label={m('codePoints')} value={stats.codePoints} />
          </StatGrid>
          <p className="text-xs text-fg-mute mb-2">
            {m('smallestEncoding')} <span className="font-mono text-fg">{smallestEncoding}</span>
          </p>
          <ul className="space-y-1.5 text-sm">
            {encodingSupport.map((enc) => (
              <li key={enc.name} className="flex items-center gap-2">
                {enc.fits ? (
                  <Check className="h-3.5 w-3.5 text-ok shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-bad shrink-0" />
                )}
                <span className={enc.fits ? 'text-fg text-xs' : 'text-fg-mute line-through text-xs'}>{enc.name}</span>
                <span className="ml-auto font-mono text-[11px] text-fg-mute">{enc.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-semibold text-sm mb-2">{m('textDetails')}</p>
            <ul className="space-y-1 text-fg-mute">
              <li>{m('spaces')} <span className="font-mono text-fg">{stats.characters - stats.charactersNoSpaces}</span></li>
              <li>{m('avgCharsPerWord')} <span className="font-mono text-fg">{stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(2) : 0}</span></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sm mb-2">{m('composition')}</p>
            <ul className="space-y-1 text-fg-mute">
              <li>ASCII (U+0000–U+007F): <span className="font-mono text-fg">{stats.asciiChars}</span></li>
              <li>Latin-1 (U+0080–U+00FF): <span className="font-mono text-fg">{stats.latin1Chars}</span></li>
              <li>BMP (U+0100–U+FFFF): <span className="font-mono text-fg">{stats.bmpChars}</span></li>
              <li>{m('supplementary')} <span className="font-mono text-fg">{stats.astralChars}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
