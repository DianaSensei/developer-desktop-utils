// OTP import/parse utilities — zero-dependency.
//
// Supports:
//   • Google Authenticator export QR payloads  (otpauth-migration://offline?data=...)
//     — base64-encoded protobuf, parsed with a minimal inline reader.
//   • Standard otpauth:// URIs                  (otpauth://totp|hotp/Label?secret=...)
//     — exported by 2FAS, Aegis, Raivo, FreeOTP, Authy, 1Password, etc.
//
// Both forms may appear inside plain-text files, JSON exports, or decoded QR images;
// `parseOtpImport` scans arbitrary text for every occurrence.

export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';
export type OtpKind = 'totp' | 'hotp';

export interface ParsedOtp {
  type: OtpKind;
  name: string;
  issuer: string;
  secret: string; // Base32
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
}

// ─── Base32 ─────────────────────────────────────────────────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0, out = 0;
  const result = new Uint8Array(Math.floor((clean.length * 5) / 8));
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error(`Invalid character: "${clean[i]}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { result[out++] = (value >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return result;
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// ─── base64 → bytes ───────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Minimal protobuf reader ──────────────────────────────────────────────────

/** Reads a base-128 varint. Uses multiplication (not <<) so counters > 2^31 are safe. */
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0, shift = 0, p = pos;
  for (;;) {
    const byte = buf[p++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, p];
}

interface RawOtpParams {
  secretBytes?: Uint8Array;
  name?: string;
  issuer?: string;
  algorithm?: number;
  digits?: number;
  type?: number;
  counter?: number;
}

function parseOtpParameters(buf: Uint8Array): RawOtpParams {
  const out: RawOtpParams = {};
  const dec = new TextDecoder();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const slice = buf.slice(pos, pos + len);
      pos += len;
      if (field === 1) out.secretBytes = slice;
      else if (field === 2) out.name = dec.decode(slice);
      else if (field === 3) out.issuer = dec.decode(slice);
    } else if (wire === 0) {
      const [val, p2] = readVarint(buf, pos);
      pos = p2;
      if (field === 4) out.algorithm = val;
      else if (field === 5) out.digits = val;
      else if (field === 6) out.type = val;
      else if (field === 7) out.counter = val;
    } else if (wire === 5) { pos += 4; }
    else if (wire === 1) { pos += 8; }
    else break;
  }
  return out;
}

function mapAlgorithm(v?: number): OtpAlgorithm {
  // 1=SHA1, 2=SHA256, 3=SHA512 (4=MD5 unsupported → fall back to SHA-1)
  return v === 2 ? 'SHA-256' : v === 3 ? 'SHA-512' : 'SHA-1';
}

function mapOtp(raw: RawOtpParams): ParsedOtp | null {
  if (!raw.secretBytes || raw.secretBytes.length === 0) return null;
  const label = raw.name || '';
  let name = label;
  let issuer = raw.issuer || '';
  if (label.includes(':')) {
    const [iss, acct] = label.split(':');
    if (!issuer) issuer = iss.trim();
    name = acct.trim();
  }
  return {
    type: raw.type === 1 ? 'hotp' : 'totp', // 1=HOTP, 2=TOTP
    name: name || 'Account',
    issuer,
    secret: base32Encode(raw.secretBytes),
    algorithm: mapAlgorithm(raw.algorithm),
    digits: raw.digits === 2 ? 8 : 6, // 1=SIX, 2=EIGHT
    period: 30,
    counter: raw.counter || 0,
  };
}

function parseMigration(buf: Uint8Array): ParsedOtp[] {
  const results: ParsedOtp[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const slice = buf.slice(pos, pos + len);
      pos += len;
      if (field === 1) {
        const mapped = mapOtp(parseOtpParameters(slice));
        if (mapped) results.push(mapped);
      }
    } else if (wire === 0) {
      const [, p2] = readVarint(buf, pos);
      pos = p2;
    } else if (wire === 5) { pos += 4; }
    else if (wire === 1) { pos += 8; }
    else break;
  }
  return results;
}

// ─── URI parsers ──────────────────────────────────────────────────────────────

function parseMigrationUri(uri: string): ParsedOtp[] {
  // Extract data param manually — URLSearchParams turns '+' into space, corrupting base64.
  const m = uri.match(/(?:[?&])data=([^&]*)/i);
  if (!m) return [];
  let raw: string;
  try { raw = decodeURIComponent(m[1]); } catch { raw = m[1]; }
  try { return parseMigration(base64ToBytes(raw)); } catch { return []; }
}

function parseOtpauthUri(uri: string): ParsedOtp | null {
  const m = uri.match(/^otpauth:\/\/(totp|hotp)\/([^?]*)\?(.*)$/i);
  if (!m) return null;
  const type = m[1].toLowerCase() as OtpKind;
  let label = '';
  try { label = decodeURIComponent(m[2]); } catch { label = m[2]; }
  const params = new URLSearchParams(m[3]);
  const secret = (params.get('secret') || '').replace(/\s/g, '').toUpperCase();
  if (!secret) return null;

  let issuer = params.get('issuer') || '';
  let name = label;
  if (label.includes(':')) {
    const [iss, acct] = label.split(':');
    if (!issuer) issuer = iss.trim();
    name = acct.trim();
  }

  const algRaw = (params.get('algorithm') || 'SHA1').toUpperCase();
  const algorithm: OtpAlgorithm = algRaw.includes('512') ? 'SHA-512' : algRaw.includes('256') ? 'SHA-256' : 'SHA-1';
  const digits = Math.max(1, parseInt(params.get('digits') || '6') || 6);
  const period = Math.max(1, parseInt(params.get('period') || '30') || 30);
  const counter = parseInt(params.get('counter') || '0') || 0;

  return { type, name: name || 'Account', issuer, secret, algorithm, digits, period, counter };
}

/** Scans arbitrary text (plain, JSON, or decoded-QR content) for every OTP entry. */
export function parseOtpImport(text: string): ParsedOtp[] {
  const results: ParsedOtp[] = [];
  for (const u of text.match(/otpauth-migration:\/\/offline\?[^\s"'<>]+/gi) || []) {
    results.push(...parseMigrationUri(u));
  }
  for (const u of text.match(/otpauth:\/\/(?:totp|hotp)\/[^\s"'<>]+/gi) || []) {
    const p = parseOtpauthUri(u);
    if (p) results.push(p);
  }
  return results;
}
