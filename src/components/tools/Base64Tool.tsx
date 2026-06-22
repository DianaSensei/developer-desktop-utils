import { useDeferredValue, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Eye, EyeOff, Lock, ArrowLeftRight, Check, X, KeyRound, Code } from 'lucide-react';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import CryptoJS from 'crypto-js';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'encode' | 'hash' | 'encrypt';
type EncodeMode = 'encode' | 'decode';
type AesMode = 'encrypt' | 'decrypt';

// ─── Encoding codecs ──────────────────────────────────────────────────────────

interface Codec {
  id: string;
  label: string;
  description: string;
  encode: (input: string) => string;
  decode: (input: string) => string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBytes(input: string) { return textEncoder.encode(input); }
function fromBytes(bytes: Uint8Array) { return textDecoder.decode(bytes); }

function base64Encode(input: string) {
  let binary = '';
  toBytes(input).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function base64Decode(input: string) {
  const binary = atob(input.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return fromBytes(bytes);
}

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function base62Encode(input: string) {
  const bytes = toBytes(input);
  if (bytes.length === 0) return '';
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) { encoded = BASE62_ALPHABET[Number(value % 62n)] + encoded; value /= 62n; }
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
  while (value > 0n) { out.unshift(Number(value % 256n)); value /= 256n; }
  const bytes = new Uint8Array(leadingZeros + out.length);
  bytes.set(out, leadingZeros);
  return fromBytes(bytes);
}

function rot13(input: string) {
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function urlEncode(input: string) { return encodeURIComponent(input); }
function urlDecode(input: string) { return decodeURIComponent(input); }

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
function htmlEncode(input: string) {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default:  return '&#39;';
    }
  });
}
function htmlDecode(input: string) {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return HTML_NAMED_ENTITIES[entity] ?? match;
  });
}

function quotedPrintableEncode(input: string) {
  const bytes = toBytes(input);
  let out = '';
  let lineLength = 0;
  const push = (chunk: string) => {
    if (lineLength + chunk.length > 75) { out += '=\r\n'; lineLength = 0; }
    out += chunk; lineLength += chunk.length;
  };
  for (const byte of bytes) {
    if (byte === 0x0a) { out += '\r\n'; lineLength = 0; }
    else if (byte === 0x0d) { continue; }
    else if ((byte >= 33 && byte <= 126 && byte !== 61) || byte === 32 || byte === 9) {
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
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; }
      else { bytes.push(char.charCodeAt(0)); }
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return fromBytes(Uint8Array.from(bytes));
}

function radixEncode(input: string, radix: number, pad: number) {
  return Array.from(toBytes(input)).map((byte) => byte.toString(radix).padStart(pad, '0')).join(' ');
}
function radixDecode(input: string, radix: number) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const bytes = tokens.map((token) => {
    const value = parseInt(token, radix);
    if (Number.isNaN(value) || value < 0 || value > 255)
      throw new Error(`Invalid base-${radix} token "${token}"`);
    return value;
  });
  return fromBytes(Uint8Array.from(bytes));
}

function rleEncode(input: string) {
  if (!input) return '';
  let out = '';
  const chars = Array.from(input);
  for (let i = 0; i < chars.length; ) {
    const char = chars[i];
    let count = 1;
    while (i + count < chars.length && chars[i + count] === char) count++;
    i += count;
    if (char === '~') { out += count === 1 ? '~~' : `~${count}~~`; }
    else if (count >= 4) { out += `~${count}~${char}`; }
    else { out += char.repeat(count); }
  }
  return out;
}
function rleDecode(input: string) {
  let out = '';
  const chars = Array.from(input);
  for (let i = 0; i < chars.length; ) {
    if (chars[i] !== '~') { out += chars[i]; i++; continue; }
    if (chars[i + 1] === '~') { out += '~'; i += 2; continue; }
    let j = i + 1;
    let digits = '';
    while (j < chars.length && /\d/.test(chars[j])) { digits += chars[j]; j++; }
    if (digits === '' || chars[j] !== '~') throw new Error('Malformed RLE escape sequence');
    const repeated = chars[j + 1];
    if (repeated === undefined) throw new Error('Malformed RLE escape sequence');
    out += repeated.repeat(parseInt(digits, 10));
    i = j + 2;
  }
  return out;
}

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
  return input.trim().toUpperCase().split(/\s+/)
    .map((word) => Array.from(word).map((char) => MORSE_MAP[char] ?? '').filter(Boolean).join(' '))
    .filter(Boolean).join(' / ');
}
function morseDecode(input: string) {
  return input.trim().split(/\s*\/\s*/)
    .map((word) => word.split(/\s+/).filter(Boolean).map((code) => MORSE_REVERSE[code] ?? '').join(''))
    .join(' ');
}

interface HuffmanNode { char: string | null; freq: number; left?: HuffmanNode; right?: HuffmanNode; }
function huffmanEncode(input: string) {
  if (!input) return '';
  const freq = new Map<string, number>();
  for (const char of input) freq.set(char, (freq.get(char) ?? 0) + 1);
  const codes: Record<string, string> = {};
  if (freq.size === 1) {
    const [char] = freq.keys();
    codes[char] = '0';
    return JSON.stringify({ codes, bits: '0'.repeat(input.length) });
  }
  let nodes: HuffmanNode[] = [...freq.entries()].map(([char, f]) => ({ char, freq: f }));
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.freq - b.freq);
    const left = nodes.shift()!;
    const right = nodes.shift()!;
    nodes.push({ char: null, freq: left.freq + right.freq, left, right });
  }
  const walk = (node: HuffmanNode, code: string) => {
    if (node.char !== null) { codes[node.char] = code; return; }
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
  try { parsed = JSON.parse(input); } catch {
    throw new Error('Huffman decode expects the JSON produced by encoding ({ codes, bits })');
  }
  if (!parsed.codes || typeof parsed.bits !== 'string')
    throw new Error('Huffman decode expects the JSON produced by encoding ({ codes, bits })');
  const reverse: Record<string, string> = {};
  for (const [char, code] of Object.entries(parsed.codes)) reverse[code] = char;
  let out = '';
  let current = '';
  for (const bit of parsed.bits) {
    current += bit;
    if (reverse[current] !== undefined) { out += reverse[current]; current = ''; }
  }
  return out;
}

const punycode = (() => {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const initialBias = 72, initialN = 128, delimiter = '-', maxInt = 2147483647;
  const adapt = (delta: number, numPoints: number, firstTime: boolean) => {
    let d = firstTime ? Math.floor(delta / damp) : delta >> 1;
    d += Math.floor(d / numPoints); let k = 0;
    while (d > ((base - tMin) * tMax) >> 1) { d = Math.floor(d / (base - tMin)); k += base; }
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
    let n = initialN, delta = 0, bias = initialBias;
    for (const cp of codePoints) { if (cp < 0x80) output.push(String.fromCharCode(cp)); }
    const basicLength = output.length; let handled = basicLength;
    if (basicLength) output.push(delimiter);
    while (handled < inputLength) {
      let m = maxInt;
      for (const cp of codePoints) { if (cp >= n && cp < m) m = cp; }
      if (m - n > Math.floor((maxInt - delta) / (handled + 1))) throw new Error('Punycode overflow');
      delta += (m - n) * (handled + 1); n = m;
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
          delta = 0; handled++;
        }
      }
      delta++; n++;
    }
    return output.join('');
  };
  const decode = (input: string) => {
    const output: number[] = [];
    let i = 0, n = initialN, bias = initialBias;
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
      n += Math.floor(i / out); i %= out; output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
  };
  return { encode, decode };
})();

const CODECS: Codec[] = [
  { id: 'base64', label: 'Base64', description: 'Binary-to-text encoding using 64 ASCII characters (UTF-8 safe).', encode: base64Encode, decode: base64Decode },
  { id: 'base62', label: 'Base62', description: 'Big-integer encoding with 0-9, A-Z, a-z (no padding characters).', encode: base62Encode, decode: base62Decode },
  { id: 'rot13',  label: 'ROT13',  description: 'Letter substitution cipher rotating by 13 places (symmetric).', encode: rot13, decode: rot13 },
  { id: 'url',    label: 'URL Encode', description: 'Percent-encoding for use in URLs (encodeURIComponent).', encode: urlEncode, decode: urlDecode },
  { id: 'html',   label: 'HTML Entities', description: "Escapes &, <, >, \", ' and decodes named/numeric entities.", encode: htmlEncode, decode: htmlDecode },
  { id: 'quoted-printable', label: 'Quoted-Printable', description: 'MIME encoding for mostly-ASCII text with =XX escapes.', encode: quotedPrintableEncode, decode: quotedPrintableDecode },
  { id: 'huffman', label: 'Huffman Coding', description: 'Prefix-code compression; output is self-describing JSON ({ codes, bits }).', encode: huffmanEncode, decode: huffmanDecode },
  { id: 'rle',    label: 'Run-Length Encoding', description: 'Compresses repeated runs; reversible with ~ escaping.', encode: rleEncode, decode: rleDecode },
  { id: 'morse',  label: 'Morse Code', description: 'Dots and dashes; letters split by space, words by " / ".', encode: morseEncode, decode: morseDecode },
  { id: 'punycode', label: 'Punycode', description: 'RFC 3492 bootstring encoding used for internationalized domains.', encode: punycode.encode, decode: punycode.decode },
  { id: 'hex',    label: 'Hex',    description: 'Each UTF-8 byte as two hex digits, space separated.', encode: (i) => radixEncode(i, 16, 2), decode: (i) => radixDecode(i, 16) },
  { id: 'octal',  label: 'Octal',  description: 'Each UTF-8 byte as octal, space separated.', encode: (i) => radixEncode(i, 8, 3), decode: (i) => radixDecode(i, 8) },
  { id: 'binary', label: 'Binary', description: 'Each UTF-8 byte as 8 bits, space separated.', encode: (i) => radixEncode(i, 2, 8), decode: (i) => radixDecode(i, 2) },
  { id: 'decimal', label: 'Decimal', description: 'Each UTF-8 byte as a decimal number, space separated.', encode: (i) => radixEncode(i, 10, 0), decode: (i) => radixDecode(i, 10) },
];

// ─── Hash algorithms ──────────────────────────────────────────────────────────

const ALGORITHMS = [
  { id: 'md5',    label: 'MD5',     bits: 128, chars: 32,  desc: 'Fast · avoid for passwords, OK for checksums' },
  { id: 'sha1',   label: 'SHA-1',   bits: 160, chars: 40,  desc: 'Legacy · not recommended for new projects' },
  { id: 'sha256', label: 'SHA-256', bits: 256, chars: 64,  desc: 'Recommended · file integrity, tokens, APIs' },
  { id: 'sha512', label: 'SHA-512', bits: 512, chars: 128, desc: 'Maximum strength · best security, slower' },
] as const;

type AlgoId = (typeof ALGORITHMS)[number]['id'];

function computeHash(id: AlgoId, input: string): string {
  switch (id) {
    case 'md5':    return CryptoJS.MD5(input).toString();
    case 'sha1':   return CryptoJS.SHA1(input).toString();
    case 'sha256': return CryptoJS.SHA256(input).toString();
    case 'sha512': return CryptoJS.SHA512(input).toString();
  }
}
function computeHmac(id: AlgoId, input: string, key: string): string {
  switch (id) {
    case 'md5':    return CryptoJS.HmacMD5(input, key).toString();
    case 'sha1':   return CryptoJS.HmacSHA1(input, key).toString();
    case 'sha256': return CryptoJS.HmacSHA256(input, key).toString();
    case 'sha512': return CryptoJS.HmacSHA512(input, key).toString();
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Base64Tool() {
  // Top-level tab
  const [tab, setTab] = usePersistentState<Tab>('devtool:codec:tab', 'encode');

  // Encode tab
  const [input, setInput]           = usePersistentState('devtool:codec:input', '');
  const [algorithm, setAlgorithm]   = usePersistentState('devtool:codec:algorithm', 'base64');
  const [encodeMode, setEncodeMode] = usePersistentState<EncodeMode>('devtool:codec:mode', 'encode');

  // Hash tab
  const [hashInput, setHashInput]   = usePersistentState('devtool:hash:hashInput', '');
  const [upperHex, setUpperHex]     = usePersistentState('devtool:hash:upperHex', false);
  const [hmacKey, setHmacKey]       = usePersistentState('devtool:hash:hmacKey', '');
  const [showHmacKey, setShowHmacKey] = useState(false);
  const [verifyAlgo, setVerifyAlgo] = useState<AlgoId | null>(null);
  const [verifyValue, setVerifyValue] = useState('');

  // Encrypt tab
  const [encryptInput, setEncryptInput] = usePersistentState('devtool:hash:encryptInput', '');
  const [encryptKey, setEncryptKey]     = usePersistentState('devtool:hash:key', '');
  const [aesMode, setAesMode]           = usePersistentState<AesMode>('devtool:hash:aesMode', 'encrypt');
  const [showKey, setShowKey]           = useState(false);

  // Hooks (always called, enabled param controls activity)
  useQuickPaste(setInput,         tab === 'encode');
  useQuickPaste(setHashInput,     tab === 'hash');
  useQuickPaste(setEncryptInput,  tab === 'encrypt');
  useInputHistory(input,         setInput,         tab === 'encode');
  useInputHistory(hashInput,     setHashInput,     tab === 'hash');
  useInputHistory(encryptInput,  setEncryptInput,  tab === 'encrypt');

  const deferredInput   = useDeferredValue(input);
  const deferredHash    = useDeferredValue(hashInput);
  const deferredEncrypt = useDeferredValue(encryptInput);

  // Encode tab computation
  const codec = useMemo(() => CODECS.find((c) => c.id === algorithm) ?? CODECS[0], [algorithm]);
  const { output: encodeOutput, error: encodeError } = useMemo(() => {
    if (!deferredInput) return { output: '', error: '' };
    try {
      return { output: encodeMode === 'encode' ? codec.encode(deferredInput) : codec.decode(deferredInput), error: '' };
    } catch (err) {
      return { output: '', error: err instanceof Error ? err.message : 'Conversion failed' };
    }
  }, [deferredInput, codec, encodeMode]);

  // Hash tab computation
  const hashes = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash) return { md5: '', sha1: '', sha256: '', sha512: '' };
    const raw = {
      md5:    computeHash('md5',    deferredHash),
      sha1:   computeHash('sha1',   deferredHash),
      sha256: computeHash('sha256', deferredHash),
      sha512: computeHash('sha512', deferredHash),
    };
    return upperHex
      ? { md5: raw.md5.toUpperCase(), sha1: raw.sha1.toUpperCase(), sha256: raw.sha256.toUpperCase(), sha512: raw.sha512.toUpperCase() }
      : raw;
  }, [deferredHash, upperHex]);

  const hmacs = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash || !hmacKey) return { md5: '', sha1: '', sha256: '', sha512: '' };
    const raw = {
      md5:    computeHmac('md5',    deferredHash, hmacKey),
      sha1:   computeHmac('sha1',   deferredHash, hmacKey),
      sha256: computeHmac('sha256', deferredHash, hmacKey),
      sha512: computeHmac('sha512', deferredHash, hmacKey),
    };
    return upperHex
      ? { md5: raw.md5.toUpperCase(), sha1: raw.sha1.toUpperCase(), sha256: raw.sha256.toUpperCase(), sha512: raw.sha512.toUpperCase() }
      : raw;
  }, [deferredHash, hmacKey, upperHex]);

  // Encrypt tab computation
  const aesResult = useMemo(() => {
    if (!deferredEncrypt || !encryptKey) return { output: '', error: '' };
    try {
      if (aesMode === 'encrypt') {
        return { output: CryptoJS.AES.encrypt(deferredEncrypt, encryptKey).toString(), error: '' };
      }
      const bytes = CryptoJS.AES.decrypt(deferredEncrypt, encryptKey);
      const text = bytes.toString(CryptoJS.enc.Utf8);
      return text ? { output: text, error: '' } : { output: '', error: 'Invalid key or ciphertext' };
    } catch {
      return { output: '', error: 'Decryption failed — check your key and ciphertext' };
    }
  }, [deferredEncrypt, encryptKey, aesMode]);

  // Verify hash comparison
  const verifyMatch = useMemo(() => {
    if (!verifyAlgo || !verifyValue.trim() || !hashes[verifyAlgo]) return null;
    return verifyValue.trim().toLowerCase() === hashes[verifyAlgo].toLowerCase();
  }, [verifyAlgo, verifyValue, hashes]);

  const toggleVerify = (id: AlgoId) => {
    if (verifyAlgo === id) { setVerifyAlgo(null); setVerifyValue(''); }
    else { setVerifyAlgo(id); setVerifyValue(''); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="tool-full-height">

      {/* Top-level tab navigation */}
      <div className="shrink-0 header-premium px-4 py-2.5 flex items-center gap-3">
        <div className="inline-flex h-9 rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setTab('encode')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 text-sm font-medium transition-all duration-150',
              tab === 'encode' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Code className="h-3.5 w-3.5" />
            Encode
          </button>
          <button
            type="button"
            onClick={() => setTab('hash')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 text-sm font-medium transition-all duration-150',
              tab === 'hash' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Lock className="h-3.5 w-3.5" />
            Hash
          </button>
          <button
            type="button"
            onClick={() => setTab('encrypt')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 text-sm font-medium transition-all duration-150',
              tab === 'encrypt' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Encrypt
          </button>
        </div>
      </div>

      {/* ── Encode tab ───────────────────────────────────────────────────────── */}
      {tab === 'encode' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Codec toolbar */}
          <div className="shrink-0 px-4 py-2 border-b border-border bg-muted/5 flex flex-wrap items-center gap-3">
            <Select value={algorithm} onValueChange={setAlgorithm}>
              <SelectTrigger className="h-8 w-44 text-xs rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CODECS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
              {(['encode', 'decode'] as EncodeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEncodeMode(m)}
                  className={cn(
                    'rounded-md px-3.5 text-xs font-medium capitalize transition-all duration-150',
                    encodeMode === m
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground truncate hidden sm:block">{codec.description}</span>
          </div>

          {/* Split pane */}
          <div className="flex-1 min-h-0 grid grid-rows-2 divide-y divide-border overflow-hidden">
            <div className="flex flex-col min-h-0">
              <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Input</span>
                <span className="text-[11px] text-muted-foreground/70">{quickPasteHint}</span>
              </div>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={encodeMode === 'encode' ? 'Enter text to encode' : `Enter ${codec.label} to decode`}
                className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
              />
            </div>
            <div className="flex flex-col min-h-0">
              <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Output</span>
                <Button onClick={() => copyToClipboard(encodeOutput)} size="sm" variant="ghost" disabled={!encodeOutput} className="h-6 px-2 text-xs rounded-lg">
                  <Copy className="h-3 w-3 mr-1" />Copy
                </Button>
              </div>
              <Textarea
                value={encodeError ? `Error: ${encodeError}` : encodeOutput}
                readOnly
                placeholder="Result appears here"
                className={cn('flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4', encodeError && 'text-destructive')}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Hash tab ─────────────────────────────────────────────────────────── */}
      {tab === 'hash' && (
        <div className="tool-scrollable tool-padding tool-spacer">

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
            <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              One-way · The same input always produces the same digest, but the original text cannot be recovered.
            </p>
          </div>

          <ToolSection>
            <ToolLabel>Input Text</ToolLabel>
            <ToolHint>{quickPasteHint}</ToolHint>
            <Textarea
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              placeholder="Enter text to hash…"
              className="min-h-[100px] font-mono text-sm"
            />
          </ToolSection>

          {/* Results header with case toggle */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hash Results</p>
            <button
              type="button"
              onClick={() => setUpperHex((v) => !v)}
              title={upperHex ? 'Switch to lowercase' : 'Switch to uppercase'}
              className={cn(
                'text-[11px] font-mono px-2 py-0.5 rounded border transition-colors',
                upperHex
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border/80'
              )}
            >
              {upperHex ? 'ABC' : 'abc'}
            </button>
          </div>

          <div className="space-y-2">
            {ALGORITHMS.map(({ id, label, bits, chars, desc }) => {
              const value = hashes[id];
              const isVerifying = verifyAlgo === id;
              return (
                <div key={id} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 pt-2.5 pb-1 group">
                    <div className="shrink-0 w-20">
                      <p className="text-xs font-semibold text-foreground leading-none mb-0.5">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{bits}-bit</p>
                    </div>
                    <Input
                      value={value}
                      readOnly
                      className="flex-1 h-7 font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-muted-foreground"
                      placeholder={`${chars} hex chars`}
                    />
                    <div className={cn(
                      'shrink-0 flex items-center gap-1 transition-opacity',
                      isVerifying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}>
                      <Button size="icon" variant="ghost" disabled={!value} onClick={() => copyToClipboard(value)} className="h-7 w-7" title="Copy">
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant={isVerifying ? 'secondary' : 'ghost'} disabled={!value} onClick={() => toggleVerify(id)} className="h-7 w-7" title="Verify hash">
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 px-3 pb-2">{desc}</p>
                  {isVerifying && (
                    <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-2">
                      <p className="text-[11px] text-muted-foreground font-medium">Verify {label} hash</p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={verifyValue}
                          onChange={(e) => setVerifyValue(e.target.value)}
                          placeholder="Paste a hash to compare…"
                          className="h-7 font-mono text-xs flex-1"
                          autoFocus
                        />
                        {verifyValue.trim() && verifyMatch !== null && (
                          <div className={cn(
                            'flex items-center gap-1 text-xs font-medium shrink-0',
                            verifyMatch ? 'text-green-600 dark:text-green-400' : 'text-destructive'
                          )}>
                            {verifyMatch
                              ? <><Check className="h-3.5 w-3.5" /> Match</>
                              : <><X className="h-3.5 w-3.5" /> No match</>
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* HMAC section */}
          <ToolSection>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              <ToolLabel>HMAC — Keyed Hash</ToolLabel>
            </div>
            <ToolHint>Combines your text with a secret key · used for API authentication and message signing</ToolHint>
            <div className="relative">
              <Input
                type={showHmacKey ? 'text' : 'password'}
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder="Enter HMAC secret key…"
                className="h-8 text-sm pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowHmacKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showHmacKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {hmacKey ? (
              <div className="space-y-2">
                {ALGORITHMS.map(({ id, label, bits, chars }) => {
                  const value = hmacs[id];
                  return (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/20 group">
                      <div className="shrink-0 w-24">
                        <p className="text-xs font-semibold text-foreground leading-none mb-0.5">HMAC-{label}</p>
                        <p className="text-[10px] text-muted-foreground">{bits}-bit</p>
                      </div>
                      <Input
                        value={value}
                        readOnly
                        className="flex-1 h-7 font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-muted-foreground"
                        placeholder={`${chars} hex chars`}
                      />
                      <Button size="icon" variant="ghost" disabled={!value} onClick={() => copyToClipboard(value)} className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Copy">
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50 text-center py-2">
                Enter a key above to generate HMAC signatures
              </p>
            )}
          </ToolSection>
        </div>
      )}

      {/* ── Encrypt tab ──────────────────────────────────────────────────────── */}
      {tab === 'encrypt' && (
        <div className="tool-scrollable tool-padding tool-spacer">

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50/80 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Reversible · AES-256 ciphertext can be fully recovered with the correct key.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
              {(['encrypt', 'decrypt'] as AesMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAesMode(m)}
                  className={cn(
                    'rounded-md px-3.5 text-xs font-medium capitalize transition-all duration-150',
                    aesMode === m
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">AES-256 · CBC</span>
          </div>

          <ToolSection>
            <ToolLabel>Encryption Key</ToolLabel>
            <ToolHint>Use a strong, secret passphrase</ToolHint>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={encryptKey}
                onChange={(e) => setEncryptKey(e.target.value)}
                placeholder="Enter passphrase…"
                className="h-8 text-sm pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </ToolSection>

          <ToolSection>
            <ToolLabel>{aesMode === 'encrypt' ? 'Plaintext' : 'Ciphertext'}</ToolLabel>
            <ToolHint>{quickPasteHint}</ToolHint>
            <Textarea
              value={encryptInput}
              onChange={(e) => setEncryptInput(e.target.value)}
              placeholder={aesMode === 'encrypt' ? 'Enter text to encrypt…' : 'Paste base64 ciphertext to decrypt…'}
              className="min-h-[100px] font-mono text-sm"
            />
          </ToolSection>

          {(aesResult.output || aesResult.error) && (
            <ToolSection>
              <div className="flex items-center justify-between">
                <ToolLabel>{aesMode === 'encrypt' ? 'Ciphertext' : 'Plaintext'}</ToolLabel>
                {aesResult.output && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => copyToClipboard(aesResult.output)}>
                    <Copy className="h-3 w-3 mr-1" />Copy
                  </Button>
                )}
              </div>
              {aesResult.error ? (
                <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{aesResult.error}</p>
                </div>
              ) : (
                <Textarea value={aesResult.output} readOnly className="min-h-[80px] font-mono text-xs" />
              )}
            </ToolSection>
          )}
        </div>
      )}

    </div>
  );
}
