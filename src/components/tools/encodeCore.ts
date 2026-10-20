// Pure encode / hash / encrypt primitives shared by the Encode · Hash · Encrypt
// tabs, the Pipeline tab and the MCP bridge. No React here: anything a tab can
// do, a pipeline step can do with the exact same code.

import CryptoJS from 'crypto-js';
import { sha3Hex } from '@/lib/sha3';

// ─── Encoding codecs ──────────────────────────────────────────────────────────

export interface Codec {
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
// Accepts the forms people actually paste: base64url (`-` `_`, JWT/OAuth),
// missing `=` padding, line breaks, and a `data:…;base64,` prefix. Errors
// say what is wrong instead of passing on atob's DOMException.
export function base64Decode(input: string) {
  let s = input.replace(/\s+/g, '').replace(/^data:[^,]*;base64,/i, '');
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bad = s.match(/[^A-Za-z0-9+/=]/);
  if (bad) throw new Error(`Not valid Base64: unexpected character "${bad[0]}".`);
  // Trailing padding, stripped without /=+$/ (a backtracking regex).
  let end = s.length;
  while (end > 0 && s[end - 1] === '=') end--;
  s = s.slice(0, end);
  if (s.includes('=')) throw new Error('Not valid Base64: "=" padding may only appear at the end.');
  if (s.length % 4 === 1) throw new Error('Not valid Base64: one character too many or too few (truncated input?).');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(s);
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

export const CODECS: Codec[] = [
  { id: 'base64',   label: 'Base64',            description: 'Binary-to-text encoding using 64 ASCII characters (UTF-8 safe).', encode: base64Encode, decode: base64Decode },
  { id: 'base62',   label: 'Base62',            description: 'Big-integer encoding with 0-9, A-Z, a-z (no padding characters).', encode: base62Encode, decode: base62Decode },
  { id: 'rot13',    label: 'ROT13',             description: 'Letter substitution cipher rotating by 13 places (symmetric).', encode: rot13, decode: rot13 },
  { id: 'url',      label: 'URL Encode',        description: 'Percent-encoding for use in URLs (encodeURIComponent).', encode: urlEncode, decode: urlDecode },
  { id: 'html',     label: 'HTML Entities',     description: "Escapes &, <, >, \", ' and decodes named/numeric entities.", encode: htmlEncode, decode: htmlDecode },
  { id: 'quoted-printable', label: 'Quoted-Printable', description: 'MIME encoding for mostly-ASCII text with =XX escapes.', encode: quotedPrintableEncode, decode: quotedPrintableDecode },
  { id: 'huffman',  label: 'Huffman Coding',    description: 'Prefix-code compression; output is self-describing JSON ({ codes, bits }).', encode: huffmanEncode, decode: huffmanDecode },
  { id: 'rle',      label: 'Run-Length Encoding', description: 'Compresses repeated runs; reversible with ~ escaping.', encode: rleEncode, decode: rleDecode },
  { id: 'morse',    label: 'Morse Code',        description: 'Dots and dashes; letters split by space, words by " / ".', encode: morseEncode, decode: morseDecode },
  { id: 'punycode', label: 'Punycode',          description: 'RFC 3492 bootstring encoding used for internationalized domains.', encode: punycode.encode, decode: punycode.decode },
  { id: 'hex',      label: 'Hex',               description: 'Each UTF-8 byte as two hex digits, space separated.', encode: (i) => radixEncode(i, 16, 2), decode: (i) => radixDecode(i, 16) },
  { id: 'octal',    label: 'Octal',             description: 'Each UTF-8 byte as octal, space separated.', encode: (i) => radixEncode(i, 8, 3), decode: (i) => radixDecode(i, 8) },
  { id: 'binary',   label: 'Binary',            description: 'Each UTF-8 byte as 8 bits, space separated.', encode: (i) => radixEncode(i, 2, 8), decode: (i) => radixDecode(i, 2) },
  { id: 'decimal',  label: 'Decimal',           description: 'Each UTF-8 byte as a decimal number, space separated.', encode: (i) => radixEncode(i, 10, 0), decode: (i) => radixDecode(i, 10) },
];

// ─── Hash algorithms ──────────────────────────────────────────────────────────

export const ALGORITHMS = [
  { id: 'md5',      label: 'MD5',        bits: 128, chars: 32,  desc: 'Fast · avoid for passwords, OK for checksums' },
  { id: 'ripemd160',label: 'RIPEMD-160', bits: 160, chars: 40,  desc: 'Legacy Bitcoin hash · alternative to SHA-1' },
  { id: 'sha1',     label: 'SHA-1',      bits: 160, chars: 40,  desc: 'Legacy · not recommended for new projects' },
  { id: 'sha224',   label: 'SHA-224',    bits: 224, chars: 56,  desc: 'SHA-2 · compact variant, 28-byte digest' },
  { id: 'sha256',   label: 'SHA-256',    bits: 256, chars: 64,  desc: 'Recommended · file integrity, tokens, APIs' },
  { id: 'sha384',   label: 'SHA-384',    bits: 384, chars: 96,  desc: 'SHA-2 · truncated SHA-512, 48-byte digest' },
  { id: 'sha512',   label: 'SHA-512',    bits: 512, chars: 128, desc: 'Maximum strength · best security, slower' },
  { id: 'sha3-256', label: 'SHA-3/256',  bits: 256, chars: 64,  desc: 'FIPS 202 · NIST standard SHA-3' },
  { id: 'sha3-512', label: 'SHA-3/512',  bits: 512, chars: 128, desc: 'FIPS 202 · maximum SHA-3 strength' },
  { id: 'keccak-256', label: 'Keccak-256', bits: 256, chars: 64, desc: 'Original Keccak · Ethereum addresses and signatures' },
] as const;

export type AlgoId = (typeof ALGORITHMS)[number]['id'];

// crypto-js has only one HmacSHA3, and it is Keccak-512, which would be
// misleading for any of these. Show HMAC only for algorithms with a dedicated
// per-length HmacXXX function.
export const HMAC_ALGORITHMS = ALGORITHMS.filter(
  (a) => !['sha3-256', 'sha3-512', 'keccak-256'].includes(a.id)
);

export function computeHash(id: AlgoId, input: string): string {
  switch (id) {
    case 'md5':       return CryptoJS.MD5(input).toString();
    case 'ripemd160': return CryptoJS.RIPEMD160(input).toString();
    case 'sha1':      return CryptoJS.SHA1(input).toString();
    case 'sha224':    return CryptoJS.SHA224(input).toString();
    case 'sha256':    return CryptoJS.SHA256(input).toString();
    case 'sha384':    return CryptoJS.SHA384(input).toString();
    case 'sha512':    return CryptoJS.SHA512(input).toString();
    // CryptoJS.SHA3 is pre-standard Keccak; see lib/sha3.ts.
    case 'sha3-256':  return sha3Hex(input, 256);
    case 'sha3-512':  return sha3Hex(input, 512);
    case 'keccak-256': return CryptoJS.SHA3(input, { outputLength: 256 }).toString();
  }
}

export function computeHmac(id: AlgoId, input: string, key: string | CryptoJS.lib.WordArray): string {
  switch (id) {
    case 'md5':       return CryptoJS.HmacMD5(input, key).toString();
    case 'ripemd160': return CryptoJS.HmacRIPEMD160(input, key).toString();
    case 'sha1':      return CryptoJS.HmacSHA1(input, key).toString();
    case 'sha224':    return CryptoJS.HmacSHA224(input, key).toString();
    case 'sha256':    return CryptoJS.HmacSHA256(input, key).toString();
    case 'sha384':    return CryptoJS.HmacSHA384(input, key).toString();
    case 'sha512':    return CryptoJS.HmacSHA512(input, key).toString();
    default:          return ''; // sha3-256, sha3-512 not rendered in HMAC section
  }
}

// ─── Encryption algorithms ────────────────────────────────────────────────────

// `family` is the honest axis, not `safe`.
//
//   'webcrypto' — PBKDF2-SHA256 (600k) → AES-256-GCM, via the platform. The
//                 only option here that resists an offline guess at your
//                 passphrase, and the only one that detects tampering.
//   'crypto-js' — everything the `crypto-js` library produces. These exist for
//                 INTEROP: to read what a crypto-js caller wrote and write what
//                 one can read. They all stretch a passphrase with OpenSSL's
//                 EvpKDF — MD5, ONE iteration — and none of them authenticate
//                 the ciphertext. Fine for a fixture, wrong for a secret.
//
// ECB additionally leaks plaintext structure, which is a separate problem from
// the KDF, so it keeps its own louder warning.
export const ENCRYPT_ALGOS = [
  { id: 'aes-gcm',   label: 'AES-256 GCM',  family: 'webcrypto', desc: 'Recommended · PBKDF2-SHA256 (600k) key stretching, authenticated, random salt + IV per message', weak: false },
  { id: 'aes-cbc',   label: 'AES-256 CBC',  family: 'crypto-js', desc: 'crypto-js interop · random IV per message, but MD5 key stretching and no authentication',        weak: false },
  { id: 'aes-ctr',   label: 'AES-256 CTR',  family: 'crypto-js', desc: 'crypto-js interop · stream mode, no padding needed',                                             weak: false },
  { id: 'aes-ecb',   label: 'AES-256 ECB',  family: 'crypto-js', desc: 'Weak · identical blocks produce identical ciphertext, avoid',                                    weak: true  },
  { id: 'aes-cfb',   label: 'AES-256 CFB',  family: 'crypto-js', desc: 'crypto-js interop · cipher feedback, stream-like',                                               weak: false },
  { id: 'aes-ofb',   label: 'AES-256 OFB',  family: 'crypto-js', desc: 'crypto-js interop · output feedback, errors do not propagate',                                   weak: false },
  { id: 'tripledes', label: 'Triple DES',   family: 'crypto-js', desc: 'Legacy 3DES · 112-bit effective security, widely supported',                                     weak: false },
  { id: 'rabbit',    label: 'Rabbit',       family: 'crypto-js', desc: 'Fast stream cipher · compact key setup, 128-bit key',                                            weak: false },
] as const;

export type EncryptAlgo = (typeof ENCRYPT_ALGOS)[number]['id'];

// The crypto-js half of the table. `aes-gcm` never reaches here — it is async
// and goes through `lib/aesGcm.ts` instead.
export type CryptoJsAlgo = Exclude<EncryptAlgo, 'aes-gcm'>;

export function doEncrypt(algo: CryptoJsAlgo, plaintext: string, key: string): string {
  switch (algo) {
    case 'aes-cbc':
      return CryptoJS.AES.encrypt(plaintext, key).toString();
    case 'aes-ctr':
      return CryptoJS.AES.encrypt(plaintext, key, {
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding,
      }).toString();
    case 'aes-ecb':
      return CryptoJS.AES.encrypt(plaintext, key, { mode: CryptoJS.mode.ECB }).toString();
    case 'aes-cfb':
      return CryptoJS.AES.encrypt(plaintext, key, { mode: CryptoJS.mode.CFB }).toString();
    case 'aes-ofb':
      return CryptoJS.AES.encrypt(plaintext, key, { mode: CryptoJS.mode.OFB }).toString();
    case 'tripledes':
      return CryptoJS.TripleDES.encrypt(plaintext, key).toString();
    case 'rabbit':
      return CryptoJS.Rabbit.encrypt(plaintext, key).toString();
  }
}

export function doDecrypt(algo: CryptoJsAlgo, ciphertext: string, key: string): string {
  switch (algo) {
    case 'aes-cbc': {
      const b = CryptoJS.AES.decrypt(ciphertext, key);
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'aes-ctr': {
      const b = CryptoJS.AES.decrypt(ciphertext, key, {
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding,
      });
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'aes-ecb': {
      const b = CryptoJS.AES.decrypt(ciphertext, key, { mode: CryptoJS.mode.ECB });
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'aes-cfb': {
      const b = CryptoJS.AES.decrypt(ciphertext, key, { mode: CryptoJS.mode.CFB });
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'aes-ofb': {
      const b = CryptoJS.AES.decrypt(ciphertext, key, { mode: CryptoJS.mode.OFB });
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'tripledes': {
      const b = CryptoJS.TripleDES.decrypt(ciphertext, key);
      return b.toString(CryptoJS.enc.Utf8);
    }
    case 'rabbit': {
      const b = CryptoJS.Rabbit.decrypt(ciphertext, key);
      return b.toString(CryptoJS.enc.Utf8);
    }
  }
}

