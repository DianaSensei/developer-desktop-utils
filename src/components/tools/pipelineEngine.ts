// Pipeline step execution — pure, async, no React.
//
// Every step reuses the code its dedicated tab runs: codecs, hashes and
// ciphers come from encodeCore.ts / lib/aesGcm.ts, JWT and JWS from
// jwt/jwtCrypto.ts. A pipeline is therefore never a second implementation
// that can drift from what the tabs produce.

import CryptoJS from 'crypto-js';
import { CompactSign, compactVerify, base64url } from 'jose';
import {
  CODECS, HMAC_ALGORITHMS, ALGORITHMS, ENCRYPT_ALGOS,
  base64Decode, computeHash, computeHmac, doEncrypt, doDecrypt,
  type AlgoId, type CryptoJsAlgo, type EncryptAlgo,
} from './encodeCore';
import { decryptAesGcm, encryptAesGcm } from '@/lib/aesGcm';
import {
  JWT_ALGORITHMS, decodeSecret, normalizeToken, resolveKey, signToken, verifyToken,
  type JwtAlgorithm, type SecretEncoding,
} from './jwt/jwtCrypto';

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * One row in the field table.
 * 'json'   → key from JSON object, value auto-read from parsed JSON
 * 'custom' → key + value both user-defined; can sit anywhere in the list
 */
export interface FieldConfig {
  id: string;
  type: 'json' | 'custom';
  key: string;
  customValue?: string;
  enabled: boolean;
}

export type StepOp =
  // Input
  | 'text-sunk' | 'json-input'
  // Encode
  | 'encode' | 'decode'
  // Sign / Hash / Encrypt
  | 'hash' | 'hmac' | 'encrypt' | 'decrypt'
  // JWT / JWS
  | 'jwt-decode' | 'jwt-sign' | 'jwt-verify' | 'jws-sign' | 'jws-verify'
  // Extract
  | 'json-path' | 'regex-extract' | 'split-pick'
  // Transform
  | 'uppercase' | 'lowercase' | 'trim' | 'prepend' | 'append' | 'replace' | 'json-format';

export type DigestFormat = 'hex' | 'base64' | 'base64url';
export type JwtPart = 'payload' | 'header' | 'signature' | 'all';

export interface PipelineStep {
  id: string;
  op: StepOp;
  // Text input step
  textValue?: string;
  // JSON input step
  jsonText?: string;
  jsonFields?: FieldConfig[];
  jsonSeparator?: string;
  jsonSort?: 'none' | 'asc' | 'desc';
  jsonFormat?: 'key=value' | 'value';
  // Hash / HMAC
  algorithm?: string;
  /** Secret, passphrase or PEM/JWK. Never persisted in the steps: the tab keeps it in the vault. */
  key?: string;
  /** How an HMAC key (HMAC step, HS* JWT/JWS) is written down. */
  keyEncoding?: SecretEncoding;
  upperHex?: boolean;
  digest?: DigestFormat;
  // Encode / Decode
  codec?: string;
  // Encrypt / Decrypt
  cipher?: EncryptAlgo;
  // JWT / JWS
  jwtAlg?: JwtAlgorithm;
  /** Extra protected-header fields as JSON (kid, typ, cty…). */
  jwtHeader?: string;
  jwtIssuedAt?: boolean;
  jwtExpiresIn?: string;
  jwtPart?: JwtPart;
  /** jws-sign: output `header..signature`. */
  jwsDetached?: boolean;
  /** jws-verify: payload of a detached JWS. */
  detachedPayload?: string;
  /** jwt-verify / jws-verify: the pasted key, or the leaf certificate in the token's own `x5c` header. */
  keySource?: 'key' | 'x5c';
  // Extract
  path?: string;
  pattern?: string;
  regexFlags?: string;
  /** Capture group; empty = group 1 when the pattern has one, else the whole match. */
  group?: string;
  matchAll?: boolean;
  splitSep?: string;
  splitIndex?: string;
  // Prepend / Append
  text?: string;
  // Replace
  find?: string;
  replacement?: string;
  regex?: boolean;
  // JSON format
  jsonIndent?: 'pretty' | 'minify';
}

export interface StepResult { output: string; error?: string; }

/** Steps whose `key` is a credential, kept in the vault by step id. */
export const SECRET_OPS: ReadonlySet<StepOp> = new Set<StepOp>([
  'hmac', 'encrypt', 'decrypt', 'jwt-sign', 'jwt-verify', 'jws-sign', 'jws-verify',
]);

/** Steps that make their own value instead of transforming the previous one. */
const SOURCE_OPS: ReadonlySet<StepOp> = new Set<StepOp>(['text-sunk', 'json-input', 'prepend', 'append']);

// ─── Codecs ────────────────────────────────────────────────────────────────────

export interface PipelineCodec { id: string; label: string; encode: (s: string) => string; decode: (s: string) => string; }

const enc = new TextEncoder(), dec = new TextDecoder();

function base64urlEncode(input: string) {
  return base64url.encode(enc.encode(input));
}

// Compact hex (no spaces) is what signatures and APIs exchange; the Encode
// tab's spaced hex stays available as "Hex (spaced)".
function hexEncode(input: string) {
  return Array.from(enc.encode(input), (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexDecode(input: string) {
  const clean = input.replace(/\s+/g, '').replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Not valid hex — expected an even number of 0-9 a-f characters.');
  }
  return dec.decode(Uint8Array.from(clean.match(/../g) ?? [], (t) => parseInt(t, 16)));
}

const byId = (id: string) => CODECS.find((c) => c.id === id)!;

/** Pipeline codecs: the Encode tab's, plus base64url and compact hex. Ids of earlier versions are kept. */
export const PIPELINE_CODECS: PipelineCodec[] = [
  byId('base64'),
  { id: 'base64url', label: 'Base64 URL', encode: base64urlEncode, decode: base64Decode },
  byId('url'),
  { id: 'hex', label: 'Hex', encode: hexEncode, decode: hexDecode },
  { ...byId('hex'), id: 'hex-spaced', label: 'Hex (spaced)' },
  ...CODECS.filter((c) => !['base64', 'url', 'hex'].includes(c.id)),
];

// ─── Algorithm lists ───────────────────────────────────────────────────────────

export { ALGORITHMS as HASH_ALGORITHMS, HMAC_ALGORITHMS, ENCRYPT_ALGOS, JWT_ALGORITHMS };

/** JWS signs arbitrary bytes, so `none` (an unsigned JWT) has no place there. */
export const JWS_ALGORITHMS = JWT_ALGORITHMS.filter((a) => a.alg !== 'none');

// ─── JSON helpers ──────────────────────────────────────────────────────────────

export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Recursively flatten any JSON value into a flat string map.
 * Objects use dot notation (user.name), arrays use bracket notation (items[0]).
 */
export function flattenJson(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = '';
  } else if (typeof value !== 'object') {
    if (prefix) out[prefix] = String(value);
  } else if (Array.isArray(value)) {
    if (value.length === 0 && prefix) { out[prefix] = '[]'; }
    else value.forEach((item, i) => Object.assign(out, flattenJson(item, prefix ? `${prefix}[${i}]` : `[${i}]`)));
  } else {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0 && prefix) { out[prefix] = '{}'; }
    else keys.forEach((k) => Object.assign(out, flattenJson(obj[k], prefix ? `${prefix}.${k}` : k)));
  }
  return out;
}

function parseJson(text: string, what: string): unknown {
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${what} is not valid JSON: ${(e as Error).message}`); }
}

/** A value as the next step should see it: strings raw, everything else as JSON. */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value);
}

/**
 * Reads `data.items[0].id`, `$.data["a.b"]`, `items[-1]` — the same dot /
 * bracket notation the JSON Input step shows for its fields.
 */
export function readJsonPath(root: unknown, path: string): unknown {
  const p = path.trim().replace(/^\$\.?/, '');
  if (!p) return root;
  const tokens: (string | number)[] = [];
  const re = /\[\s*(-?\d+)\s*\]|\[\s*(["'])(.*?)\2\s*\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    if (m[1] !== undefined) tokens.push(Number(m[1]));
    else if (m[3] !== undefined) tokens.push(m[3]);
    else tokens.push(m[4]);
  }
  let cur: unknown = root;
  for (const t of tokens) {
    if (Array.isArray(cur) && typeof t === 'number') {
      const idx = t < 0 ? cur.length + t : t;
      if (idx < 0 || idx >= cur.length) throw new Error(`Path not found: index ${t} is out of range (length ${cur.length}).`);
      cur = cur[idx];
    } else if (cur !== null && typeof cur === 'object' && String(t) in (cur as object)) {
      cur = (cur as Record<string, unknown>)[String(t)];
    } else {
      throw new Error(`Path not found: no "${t}" in ${Array.isArray(cur) ? 'array' : cur === null ? 'null' : typeof cur}.`);
    }
  }
  return cur;
}

/** `\n`, `\t` typed into a one-line box mean newline / tab. */
function unescapeSep(sep: string) {
  return sep.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
}

// ─── Digest formatting ─────────────────────────────────────────────────────────

function formatDigest(hex: string, step: PipelineStep): string {
  const format = step.digest ?? 'hex';
  if (format === 'hex') return step.upperHex ? hex.toUpperCase() : hex;
  const b64 = CryptoJS.enc.Hex.parse(hex).toString(CryptoJS.enc.Base64);
  return format === 'base64' ? b64 : b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── JWT / JWS helpers ─────────────────────────────────────────────────────────

function parseHeader(text: string | undefined): Record<string, unknown> | undefined {
  if (!text?.trim()) return undefined;
  const parsed = parseJson(text, 'Header');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Header must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function decodeSegment(segment: string, name: string): string {
  try { return dec.decode(base64url.decode(segment)); }
  catch { throw new Error(`The ${name} part is not valid base64url.`); }
}

/** Decodes a JWT or any compact JWS (payload need not be JSON). Never verifies. */
export function decodeCompact(token: string, part: JwtPart): string {
  const t = normalizeToken(token);
  const parts = t.split('.');
  if (parts.length === 5) throw new Error('This is an encrypted token (JWE, 5 parts); only signed tokens (3 parts) can be decoded.');
  if (parts.length !== 3) throw new Error(`A JWT/JWS has 3 parts separated by dots; this has ${parts.length}.`);
  const header = parseJson(decodeSegment(parts[0], 'header'), 'Header');
  const payloadText = decodeSegment(parts[1], 'payload');
  let payload: unknown = payloadText;
  try { payload = JSON.parse(payloadText); } catch { /* a JWS payload may be any bytes */ }
  switch (part) {
    case 'header':    return JSON.stringify(header, null, 2);
    case 'payload':   return stringify(payload);
    case 'signature': return parts[2];
    case 'all':       return JSON.stringify({ header, payload, signature: parts[2] }, null, 2);
  }
}

function keyInput(step: PipelineStep) {
  return { material: step.key ?? '', encoding: step.keyEncoding ?? 'utf8' };
}

/**
 * The leaf certificate of a token's `x5c` header, as PEM — how Apple signs
 * App Store / Advanced Commerce JWS (ES256 with a three-certificate chain).
 *
 * This proves the payload was signed by the key in that certificate, NOT that
 * the certificate chains to Apple's root: anyone can put their own
 * certificate in `x5c`. The step's UI says so; a server must validate the chain.
 */
export function x5cLeafPem(token: string): string {
  const [h] = normalizeToken(token).split('.');
  const header = parseJson(decodeSegment(h ?? '', 'header'), 'Header') as { x5c?: unknown };
  const leaf = Array.isArray(header.x5c) ? header.x5c[0] : undefined;
  if (typeof leaf !== 'string' || !leaf) throw new Error('The token header has no x5c certificate chain to verify with.');
  const body = leaf.replace(/\s+/g, '').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

function verifyKeyInput(step: PipelineStep, token: string) {
  return step.keySource === 'x5c' ? { material: x5cLeafPem(token) } : keyInput(step);
}

async function jwsSign(step: PipelineStep, input: string): Promise<string> {
  const alg = step.jwtAlg ?? 'HS256';
  if (alg === 'none') throw new Error('JWS needs a signing algorithm; "none" exists only for unsigned JWTs.');
  const key = await resolveKey(keyInput(step), alg, 'sign');
  // `alg` last, as in signToken: the header box can't contradict the key.
  const jws = await new CompactSign(enc.encode(input))
    .setProtectedHeader({ ...parseHeader(step.jwtHeader), alg })
    .sign(key as never);
  if (!step.jwsDetached) return jws;
  const [h, , s] = jws.split('.');
  return `${h}..${s}`;
}

async function jwsVerify(step: PipelineStep, input: string): Promise<string> {
  const alg = step.jwtAlg ?? 'HS256';
  if (alg === 'none') throw new Error('An unsigned token has nothing to verify.');
  let token = normalizeToken(input);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`A JWS has 3 parts separated by dots; this has ${parts.length}.`);
  if (!parts[1]) {
    // Detached payload (`header..signature`), as Open Banking-style APIs send it.
    if (!step.detachedPayload) throw new Error('This JWS has a detached payload — enter it to verify.');
    token = `${parts[0]}.${base64urlEncode(step.detachedPayload)}.${parts[2]}`;
  }
  const header = parseJson(decodeSegment(parts[0], 'header'), 'Header') as { alg?: unknown };
  // Reported, never obeyed — see the algorithm-confusion note in jwtCrypto.ts.
  if (typeof header.alg === 'string' && header.alg !== alg) {
    throw new Error(`Token header says alg "${header.alg}" but this step verifies as ${alg}.`);
  }
  const key = await resolveKey(verifyKeyInput(step, token), alg, 'verify');
  try {
    const { payload } = await compactVerify(token, key as never, { algorithms: [alg] });
    return dec.decode(payload);
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      throw new Error('Signature does not match — wrong key, or the payload was altered.');
    }
    throw e;
  }
}

// ─── Step execution ────────────────────────────────────────────────────────────

/** Error produced by the pipeline itself; translated for display. */
export const KEY_REQUIRED = '\u0000secretKeyRequired';
export const STEP_FAILED = '\u0000stepFailed';

function hmacKey(step: PipelineStep): string | CryptoJS.lib.WordArray {
  const encoding = step.keyEncoding ?? 'utf8';
  if (encoding === 'utf8') return step.key ?? '';
  const bytes = decodeSecret(step.key ?? '', encoding);
  return CryptoJS.enc.Hex.parse(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
}

async function run(step: PipelineStep, input: string): Promise<string> {
  switch (step.op) {
    case 'text-sunk':
      return step.textValue ?? '';
    case 'json-input': {
      let flatMap: Record<string, string> = {};
      try { flatMap = flattenJson(JSON.parse(step.jsonText ?? '')); } catch { /* empty */ }
      let active = (step.jsonFields ?? []).filter((f) => f.enabled);
      const sort = step.jsonSort ?? 'none';
      // Byte (ASCII) order, as payment gateways sign it (OnePay vpc_*,
      // Alipay, WeChat Pay): `Version` < `amount`, `vpc_MerchTxnRef` <
      // `vpc_Merchant`. localeCompare would put lowercase first.
      if (sort === 'asc')  active = [...active].sort((a, b) => compareCodeUnits(a.key, b.key));
      if (sort === 'desc') active = [...active].sort((a, b) => compareCodeUnits(b.key, a.key));
      const sep = step.jsonSeparator ?? '&';
      const fmt = step.jsonFormat ?? 'key=value';
      return active.map((f) => {
        const val = f.type === 'custom' ? (f.customValue ?? '') : (flatMap[f.key] ?? '');
        return fmt === 'key=value' ? `${f.key}=${val}` : val;
      }).join(sep);
    }

    // Encode
    case 'encode':
    case 'decode': {
      const codec = PIPELINE_CODECS.find((c) => c.id === (step.codec ?? 'base64')) ?? PIPELINE_CODECS[0];
      return step.op === 'encode' ? codec.encode(input) : codec.decode(input);
    }

    // Sign / Hash / Encrypt
    case 'hash':
      return formatDigest(computeHash((step.algorithm ?? 'sha256') as AlgoId, input), step);
    case 'hmac':
      if (!step.key) throw new Error(KEY_REQUIRED);
      if (!HMAC_ALGORITHMS.some((a) => a.id === (step.algorithm ?? 'sha256'))) {
        throw new Error(`HMAC is not available for ${step.algorithm} — pick another algorithm.`);
      }
      return formatDigest(computeHmac((step.algorithm ?? 'sha256') as AlgoId, input, hmacKey(step)), step);
    case 'encrypt':
    case 'decrypt': {
      if (!step.key) throw new Error(KEY_REQUIRED);
      const cipher = step.cipher ?? 'aes-gcm';
      if (cipher === 'aes-gcm') {
        return step.op === 'encrypt' ? encryptAesGcm(input, step.key) : decryptAesGcm(input, step.key);
      }
      if (step.op === 'encrypt') return doEncrypt(cipher as CryptoJsAlgo, input, step.key);
      let plain = '';
      try { plain = doDecrypt(cipher as CryptoJsAlgo, input.trim(), step.key); } catch { /* malformed UTF-8 */ }
      // crypto-js answers a wrong key with garbage or nothing, not an error.
      if (!plain) throw new Error('Decryption failed — wrong key, algorithm or ciphertext.');
      return plain;
    }

    // JWT / JWS
    case 'jwt-decode':
      return decodeCompact(input, step.jwtPart ?? 'payload');
    case 'jwt-sign':
      return signToken({
        algorithm: step.jwtAlg ?? 'HS256',
        payload: input,
        key: keyInput(step),
        header: parseHeader(step.jwtHeader),
        issuedAt: step.jwtIssuedAt ?? true,
        expiresIn: step.jwtExpiresIn || undefined,
      });
    case 'jwt-verify': {
      const outcome = await verifyToken({ token: input, algorithm: step.jwtAlg ?? 'HS256', key: verifyKeyInput(step, input) });
      if (!outcome.valid) throw new Error(outcome.message);
      return JSON.stringify(outcome.payload, null, 2);
    }
    case 'jws-sign':
      return jwsSign(step, input);
    case 'jws-verify':
      return jwsVerify(step, input);

    // Extract
    case 'json-path':
      return stringify(readJsonPath(parseJson(input, 'Input'), step.path ?? ''));
    case 'regex-extract': {
      if (!step.pattern) return input;
      const flags = (step.regexFlags ?? '').replace(/[^dimsuvy]/g, '');
      const groupOf = (m: RegExpMatchArray) => {
        const g = step.group?.trim();
        const value = g ? (/^\d+$/.test(g) ? m[Number(g)] : m.groups?.[g]) : m[m.length > 1 ? 1 : 0];
        return value ?? '';
      };
      if (step.matchAll) {
        const all = [...input.matchAll(new RegExp(step.pattern, flags + 'g'))];
        if (all.length === 0) throw new Error('No match.');
        return all.map(groupOf).join('\n');
      }
      const m = input.match(new RegExp(step.pattern, flags));
      if (!m) throw new Error('No match.');
      return groupOf(m);
    }
    case 'split-pick': {
      const pieces = input.split(unescapeSep(step.splitSep ?? ','));
      const raw = Number.parseInt(step.splitIndex ?? '0', 10);
      const n = Number.isNaN(raw) ? 0 : raw;
      const idx = n < 0 ? pieces.length + n : n;
      if (idx < 0 || idx >= pieces.length) throw new Error(`Index ${n} is out of range — the split gave ${pieces.length} piece(s).`);
      return pieces[idx];
    }

    // Transform
    case 'uppercase': return input.toUpperCase();
    case 'lowercase': return input.toLowerCase();
    case 'trim':      return input.trim();
    case 'prepend':   return (step.text ?? '') + input;
    case 'append':    return input + (step.text ?? '');
    case 'replace':
      if (step.regex) return step.find ? input.replace(new RegExp(step.find, 'g'), step.replacement ?? '') : input;
      return input.split(step.find ?? '').join(step.replacement ?? '');
    case 'json-format': {
      const value = parseJson(input, 'Input');
      return step.jsonIndent === 'minify' ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    }
    default:
      return input;
  }
}

export async function executeStep(step: PipelineStep, input: string): Promise<StepResult> {
  // An empty value flows through untouched, so a half-built pipeline shows
  // dashes rather than a wall of "invalid input" errors.
  if (!input && !SOURCE_OPS.has(step.op)) return { output: '' };
  try {
    return { output: await run(step, input) };
  } catch (err) {
    return { output: '', error: err instanceof Error && err.message ? err.message : STEP_FAILED };
  }
}

/**
 * Remembers each step's result by (step, input): editing step 5 does not
 * re-run the 600k-iteration PBKDF2 of step 2, and a step whose output is
 * random (AES-GCM salt + IV) or time-based (JWT `iat`) holds still until
 * something it depends on changes. In memory only, never persisted.
 */
export class StepCache {
  private map = new Map<string, StepResult>();
  constructor(private limit = 200) {}

  async run(step: PipelineStep, input: string): Promise<StepResult> {
    const { id: _id, ...config } = step;
    const k = `${JSON.stringify(config)}\u0000${input}`;
    const hit = this.map.get(k);
    if (hit) return hit;
    const res = await executeStep(step, input);
    if (this.map.size >= this.limit) this.map.delete(this.map.keys().next().value!);
    this.map.set(k, res);
    return res;
  }
}

export async function executePipeline(steps: PipelineStep[], cache?: StepCache): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let current = '';
  for (const step of steps) {
    const res = cache ? await cache.run(step, current) : await executeStep(step, current);
    results.push(res);
    if (res.error) break;
    current = res.output;
  }
  return results;
}
