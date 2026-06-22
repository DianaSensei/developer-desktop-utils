import { useDeferredValue, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { CopyButton } from '@/components/CopyButton';
import { StatusMessage } from '@/components/StatusMessage';

type Mode = 'encode' | 'decode';

interface Codec {
  id: string;
  label: string;
  description: string;
  encode: (input: string) => string;
  decode: (input: string) => string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBytes(input: string) {
  return textEncoder.encode(input);
}

function fromBytes(bytes: Uint8Array) {
  return textDecoder.decode(bytes);
}

// --- Base64 (UTF-8 safe) ---------------------------------------------------
function base64Encode(input: string) {
  let binary = '';
  toBytes(input).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64Decode(input: string) {
  const binary = atob(input.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return fromBytes(bytes);
}

// --- Base62 ----------------------------------------------------------------
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62Encode(input: string) {
  const bytes = toBytes(input);
  if (bytes.length === 0) return '';

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);

  let encoded = '';
  while (value > 0n) {
    encoded = BASE62_ALPHABET[Number(value % 62n)] + encoded;
    value /= 62n;
  }

  return BASE62_ALPHABET[0].repeat(leadingZeros) + encoded;
}

function base62Decode(input: string) {
  const trimmed = input.trim();
  if (trimmed === '') return '';

  let leadingZeros = 0;
  while (leadingZeros < trimmed.length && trimmed[leadingZeros] === BASE62_ALPHABET[0]) leadingZeros++;

  let value = 0n;
  for (const char of trimmed) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base62 character "${char}"`);
    value = value * 62n + BigInt(index);
  }

  const out: number[] = [];
  while (value > 0n) {
    out.unshift(Number(value % 256n));
    value /= 256n;
  }

  const bytes = new Uint8Array(leadingZeros + out.length);
  bytes.set(out, leadingZeros);
  return fromBytes(bytes);
}

// --- ROT13 (symmetric) -----------------------------------------------------
function rot13(input: string) {
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// --- URL encoding ----------------------------------------------------------
function urlEncode(input: string) {
  return encodeURIComponent(input);
}

function urlDecode(input: string) {
  return decodeURIComponent(input);
}

// --- HTML entity encoding --------------------------------------------------
const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function htmlEncode(input: string) {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function htmlDecode(input: string) {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return HTML_NAMED_ENTITIES[entity] ?? match;
  });
}

// --- Quoted-Printable ------------------------------------------------------
function quotedPrintableEncode(input: string) {
  const bytes = toBytes(input);
  let out = '';
  let lineLength = 0;

  const push = (chunk: string) => {
    if (lineLength + chunk.length > 75) {
      out += '=\r\n';
      lineLength = 0;
    }
    out += chunk;
    lineLength += chunk.length;
  };

  for (const byte of bytes) {
    if (byte === 0x0a) {
      out += '\r\n';
      lineLength = 0;
    } else if (byte === 0x0d) {
      // normalize CRLF/CR to the LF branch
      continue;
    } else if ((byte >= 33 && byte <= 126 && byte !== 61) || byte === 32 || byte === 9) {
      push(String.fromCharCode(byte));
    } else {
      push('=' + byte.toString(16).toUpperCase().padStart(2, '0'));
    }
  }

  return out;
}

function quotedPrintableDecode(input: string) {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const char = withoutSoftBreaks[i];
    if (char === '=') {
      const hex = withoutSoftBreaks.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(char.charCodeAt(0));
      }
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }

  return fromBytes(Uint8Array.from(bytes));
}

// --- Radix encodings (hex / octal / binary / decimal) ----------------------
function radixEncode(input: string, radix: number, pad: number) {
  return Array.from(toBytes(input))
    .map((byte) => byte.toString(radix).padStart(pad, '0'))
    .join(' ');
}

function radixDecode(input: string, radix: number) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const bytes = tokens.map((token) => {
    const value = parseInt(token, radix);
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Invalid base-${radix} token "${token}"`);
    }
    return value;
  });
  return fromBytes(Uint8Array.from(bytes));
}

// --- Run-Length Encoding (reversible, '~'-escaped) -------------------------
// Runs (>= 4) become "~<count>~<char>"; literal '~' becomes "~~".
function rleEncode(input: string) {
  if (!input) return '';
  let out = '';
  const chars = Array.from(input);

  for (let i = 0; i < chars.length; ) {
    const char = chars[i];
    let count = 1;
    while (i + count < chars.length && chars[i + count] === char) count++;
    i += count;

    if (char === '~') {
      out += count === 1 ? '~~' : `~${count}~~`;
    } else if (count >= 4) {
      out += `~${count}~${char}`;
    } else {
      out += char.repeat(count);
    }
  }

  return out;
}

function rleDecode(input: string) {
  let out = '';
  const chars = Array.from(input);

  for (let i = 0; i < chars.length; ) {
    if (chars[i] !== '~') {
      out += chars[i];
      i++;
      continue;
    }
    if (chars[i + 1] === '~') {
      out += '~';
      i += 2;
      continue;
    }
    let j = i + 1;
    let digits = '';
    while (j < chars.length && /\d/.test(chars[j])) {
      digits += chars[j];
      j++;
    }
    if (digits === '' || chars[j] !== '~') throw new Error('Malformed RLE escape sequence');
    const repeated = chars[j + 1];
    if (repeated === undefined) throw new Error('Malformed RLE escape sequence');
    out += repeated.repeat(parseInt(digits, 10));
    i = j + 2;
  }

  return out;
}

// --- Morse Code ------------------------------------------------------------
const MORSE_MAP: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

const MORSE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([char, code]) => [code, char])
);

function morseEncode(input: string) {
  return input
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map((word) =>
      Array.from(word)
        .map((char) => MORSE_MAP[char] ?? '')
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' / ');
}

function morseDecode(input: string) {
  return input
    .trim()
    .split(/\s*\/\s*/)
    .map((word) =>
      word
        .split(/\s+/)
        .filter(Boolean)
        .map((code) => MORSE_REVERSE[code] ?? '')
        .join('')
    )
    .join(' ');
}

// --- Huffman Coding (self-describing JSON) ---------------------------------
interface HuffmanNode {
  char: string | null;
  freq: number;
  left?: HuffmanNode;
  right?: HuffmanNode;
}

function huffmanEncode(input: string) {
  if (!input) return '';

  const freq = new Map<string, number>();
  for (const char of input) freq.set(char, (freq.get(char) ?? 0) + 1);

  const codes: Record<string, string> = {};

  if (freq.size === 1) {
    const [char] = freq.keys();
    codes[char] = '0';
    const bits = '0'.repeat(input.length);
    return JSON.stringify({ codes, bits });
  }

  let nodes: HuffmanNode[] = [...freq.entries()].map(([char, f]) => ({ char, freq: f }));
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.freq - b.freq);
    const left = nodes.shift()!;
    const right = nodes.shift()!;
    nodes.push({ char: null, freq: left.freq + right.freq, left, right });
  }

  const walk = (node: HuffmanNode, code: string) => {
    if (node.char !== null) {
      codes[node.char] = code;
      return;
    }
    if (node.left) walk(node.left, code + '0');
    if (node.right) walk(node.right, code + '1');
  };
  walk(nodes[0], '');

  let bits = '';
  for (const char of input) bits += codes[char];

  return JSON.stringify({ codes, bits });
}

function huffmanDecode(input: string) {
  if (!input.trim()) return '';

  let parsed: { codes: Record<string, string>; bits: string };
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Huffman decode expects the JSON produced by encoding ({ codes, bits })');
  }
  if (!parsed.codes || typeof parsed.bits !== 'string') {
    throw new Error('Huffman decode expects the JSON produced by encoding ({ codes, bits })');
  }

  const reverse: Record<string, string> = {};
  for (const [char, code] of Object.entries(parsed.codes)) reverse[code] = char;

  let out = '';
  let current = '';
  for (const bit of parsed.bits) {
    current += bit;
    if (reverse[current] !== undefined) {
      out += reverse[current];
      current = '';
    }
  }
  return out;
}

// --- Punycode (RFC 3492 bootstring) ----------------------------------------
const punycode = (() => {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;
  const delimiter = '-';
  const maxInt = 2147483647;

  const adapt = (delta: number, numPoints: number, firstTime: boolean) => {
    let d = firstTime ? Math.floor(delta / damp) : delta >> 1;
    d += Math.floor(d / numPoints);
    let k = 0;
    while (d > ((base - tMin) * tMax) >> 1) {
      d = Math.floor(d / (base - tMin));
      k += base;
    }
    return Math.floor(k + ((base - tMin + 1) * d) / (d + skew));
  };

  const digitToBasic = (digit: number) => digit + 22 + 75 * (digit < 26 ? 1 : 0);

  const basicToDigit = (codePoint: number) => {
    if (codePoint - 48 < 10) return codePoint - 22;
    if (codePoint - 65 < 26) return codePoint - 65;
    if (codePoint - 97 < 26) return codePoint - 97;
    return base;
  };

  const encode = (input: string) => {
    const output: string[] = [];
    const codePoints = Array.from(input).map((char) => char.codePointAt(0) ?? 0);
    const inputLength = codePoints.length;
    let n = initialN;
    let delta = 0;
    let bias = initialBias;

    for (const cp of codePoints) {
      if (cp < 0x80) output.push(String.fromCharCode(cp));
    }
    const basicLength = output.length;
    let handled = basicLength;
    if (basicLength) output.push(delimiter);

    while (handled < inputLength) {
      let m = maxInt;
      for (const cp of codePoints) {
        if (cp >= n && cp < m) m = cp;
      }
      if (m - n > Math.floor((maxInt - delta) / (handled + 1))) throw new Error('Punycode overflow');
      delta += (m - n) * (handled + 1);
      n = m;

      for (const cp of codePoints) {
        if (cp < n && ++delta > maxInt) throw new Error('Punycode overflow');
        if (cp === n) {
          let q = delta;
          for (let k = base; ; k += base) {
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (q < t) break;
            const baseMinusT = base - t;
            output.push(String.fromCharCode(digitToBasic(t + ((q - t) % baseMinusT))));
            q = Math.floor((q - t) / baseMinusT);
          }
          output.push(String.fromCharCode(digitToBasic(q)));
          bias = adapt(delta, handled + 1, handled === basicLength);
          delta = 0;
          handled++;
        }
      }
      delta++;
      n++;
    }

    return output.join('');
  };

  const decode = (input: string) => {
    const output: number[] = [];
    let i = 0;
    let n = initialN;
    let bias = initialBias;

    let basic = input.lastIndexOf(delimiter);
    if (basic < 0) basic = 0;

    for (let j = 0; j < basic; j++) {
      const code = input.charCodeAt(j);
      if (code >= 0x80) throw new Error('Punycode: illegal non-basic character');
      output.push(code);
    }

    let index = basic > 0 ? basic + 1 : 0;
    while (index < input.length) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        if (index >= input.length) throw new Error('Punycode: invalid input');
        const digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= base) throw new Error('Punycode: invalid input');
        if (digit > Math.floor((maxInt - i) / w)) throw new Error('Punycode overflow');
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        const baseMinusT = base - t;
        if (w > Math.floor(maxInt / baseMinusT)) throw new Error('Punycode overflow');
        w *= baseMinusT;
      }
      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      if (Math.floor(i / out) > maxInt - n) throw new Error('Punycode overflow');
      n += Math.floor(i / out);
      i %= out;
      output.splice(i++, 0, n);
    }

    return String.fromCodePoint(...output);
  };

  return { encode, decode };
})();

const CODECS: Codec[] = [
  {
    id: 'base64',
    label: 'Base64',
    description: 'Binary-to-text encoding using 64 ASCII characters (UTF-8 safe).',
    encode: base64Encode,
    decode: base64Decode,
  },
  {
    id: 'base62',
    label: 'Base62',
    description: 'Big-integer encoding with 0-9, A-Z, a-z (no padding characters).',
    encode: base62Encode,
    decode: base62Decode,
  },
  {
    id: 'rot13',
    label: 'ROT13',
    description: 'Letter substitution cipher rotating by 13 places (symmetric).',
    encode: rot13,
    decode: rot13,
  },
  {
    id: 'url',
    label: 'URL Encode',
    description: 'Percent-encoding for use in URLs (encodeURIComponent).',
    encode: urlEncode,
    decode: urlDecode,
  },
  {
    id: 'html',
    label: 'HTML Entities',
    description: 'Escapes &, <, >, ", \' and decodes named/numeric entities.',
    encode: htmlEncode,
    decode: htmlDecode,
  },
  {
    id: 'quoted-printable',
    label: 'Quoted-Printable',
    description: 'MIME encoding for mostly-ASCII text with =XX escapes.',
    encode: quotedPrintableEncode,
    decode: quotedPrintableDecode,
  },
  {
    id: 'huffman',
    label: 'Huffman Coding',
    description: 'Prefix-code compression; output is self-describing JSON ({ codes, bits }).',
    encode: huffmanEncode,
    decode: huffmanDecode,
  },
  {
    id: 'rle',
    label: 'Run-Length Encoding',
    description: 'Compresses repeated runs; reversible with ~ escaping.',
    encode: rleEncode,
    decode: rleDecode,
  },
  {
    id: 'morse',
    label: 'Morse Code',
    description: 'Dots and dashes; letters split by space, words by " / ".',
    encode: morseEncode,
    decode: morseDecode,
  },
  {
    id: 'punycode',
    label: 'Punycode',
    description: 'RFC 3492 bootstring encoding used for internationalized domains.',
    encode: punycode.encode,
    decode: punycode.decode,
  },
  {
    id: 'hex',
    label: 'Hex',
    description: 'Each UTF-8 byte as two hex digits, space separated.',
    encode: (input) => radixEncode(input, 16, 2),
    decode: (input) => radixDecode(input, 16),
  },
  {
    id: 'octal',
    label: 'Octal',
    description: 'Each UTF-8 byte as octal, space separated.',
    encode: (input) => radixEncode(input, 8, 3),
    decode: (input) => radixDecode(input, 8),
  },
  {
    id: 'binary',
    label: 'Binary',
    description: 'Each UTF-8 byte as 8 bits, space separated.',
    encode: (input) => radixEncode(input, 2, 8),
    decode: (input) => radixDecode(input, 2),
  },
  {
    id: 'decimal',
    label: 'Decimal',
    description: 'Each UTF-8 byte as a decimal number, space separated.',
    encode: (input) => radixEncode(input, 10, 0),
    decode: (input) => radixDecode(input, 10),
  },
];

export function Base64Tool() {
  const [input, setInput] = usePersistentState('devtool:codec:input', '');
  const [algorithm, setAlgorithm] = usePersistentState('devtool:codec:algorithm', 'base64');
  const [mode, setMode] = usePersistentState<Mode>('devtool:codec:mode', 'encode');

  const codec = useMemo(() => CODECS.find((item) => item.id === algorithm) ?? CODECS[0], [algorithm]);

  // Some codecs (Huffman, Punycode, base62 BigInt) are heavy. Defer the input so
  // the textarea stays responsive while converting large payloads.
  const deferredInput = useDeferredValue(input);
  const { output, error } = useMemo(() => {
    if (!deferredInput) return { output: '', error: '' };
    try {
      const result = mode === 'encode' ? codec.encode(deferredInput) : codec.decode(deferredInput);
      return { output: result, error: '' };
    } catch (err) {
      return { output: '', error: err instanceof Error ? err.message : 'Conversion failed' };
    }
  }, [deferredInput, codec, mode]);

  useQuickPaste((text) => setInput(text));
  useInputHistory(input, setInput);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-border bg-muted/10 px-4 py-2 flex flex-wrap items-center gap-3">
        <Select value={algorithm} onValueChange={setAlgorithm}>
          <SelectTrigger className="h-8 w-44 text-xs rounded-lg border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CODECS.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
          {(['encode', 'decode'] as Mode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                'rounded-md px-3 text-xs font-medium capitalize transition-smooth',
                mode === item ? 'bg-card text-foreground shadow-sm-premium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground truncate">{codec.description}</span>
      </div>

      {/* Error message */}
      {error && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <StatusMessage status="error" message={error} dismissible={false} />
        </div>
      )}

      {/* Input / Output split */}
      <div className="flex-1 min-h-0 grid grid-rows-2 divide-y divide-border overflow-hidden">
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Input</span>
            <span>{quickPasteHint}</span>
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={mode === 'encode' ? 'Enter text to encode' : `Enter ${codec.label} to decode`}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Output</span>
            <CopyButton text={output} label="Copy" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!output} />
          </div>
          <Textarea
            value={output}
            readOnly
            placeholder="Result appears here"
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>
      </div>
    </div>
  );
}
