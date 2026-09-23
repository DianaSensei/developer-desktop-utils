// JWT signing / verification core — every JWS algorithm the Web Crypto API
// in a webview can actually do, plus the unsecured `none`.
//
// Built on `jose`, the same library the API Client's `jsonwebtoken` shim uses
// (see apiclient/jsonwebtokenShim.ts for why the real npm package can't run
// here: Tauri's frontend is an OS webview, not a Node process, so there is no
// `crypto`/`Buffer` to back it). Everything below is a pure async function of
// its arguments — no React, no SDK, no persisted state — so the UI, the MCP
// bridge and the tests all drive the exact same code path.
//
// Two deliberate positions, both about not lying to the user:
//
//  1. **The algorithm is always chosen by the caller, never read from the
//     token.** Trusting a token's own `alg` header is the algorithm-confusion
//     attack (hand an RS256 verifier a token signed HS256 using the RSA
//     PUBLIC key as the HMAC secret, and a naive verifier says "valid"). A
//     debugger that reproduced that bug would teach it.
//  2. **`none` is offered, and always labelled as no signature at all.** It is
//     genuinely needed to test how a server reacts to an unsigned token, and
//     hiding it wouldn't stop anyone — hand-assembling one is three lines. It
//     never verifies under any other algorithm, and never "passes" silently.

import {
  SignJWT, jwtVerify, UnsecuredJWT,
  importPKCS8, importSPKI, importX509, importJWK,
  exportPKCS8, exportSPKI, generateKeyPair,
  decodeJwt, decodeProtectedHeader,
  errors as joseErrors,
  type JWTPayload, type JWK,
} from 'jose';

export type JwtAlgorithm =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'PS256' | 'PS384' | 'PS512'
  | 'ES256' | 'ES384' | 'ES512'
  | 'EdDSA'
  | 'none';

export type JwtFamily = 'hmac' | 'rsa' | 'rsa-pss' | 'ecdsa' | 'eddsa' | 'unsecured';

export interface AlgorithmSpec {
  alg: JwtAlgorithm;
  family: JwtFamily;
  /** What the group is called in the picker. */
  familyLabel: string;
  /** One line under the key box: what to paste for THIS algorithm. */
  keyHint: string;
}

/** Every algorithm, in the order the picker shows them. */
export const JWT_ALGORITHMS: AlgorithmSpec[] = [
  { alg: 'HS256', family: 'hmac', familyLabel: 'HMAC', keyHint: 'Shared secret — any text, or bytes in base64 / base64url / hex.' },
  { alg: 'HS384', family: 'hmac', familyLabel: 'HMAC', keyHint: 'Shared secret — any text, or bytes in base64 / base64url / hex.' },
  { alg: 'HS512', family: 'hmac', familyLabel: 'HMAC', keyHint: 'Shared secret — any text, or bytes in base64 / base64url / hex.' },
  { alg: 'RS256', family: 'rsa', familyLabel: 'RSA PKCS#1 v1.5', keyHint: 'PKCS#8 private key to sign; SPKI public key, certificate or JWK to verify.' },
  { alg: 'RS384', family: 'rsa', familyLabel: 'RSA PKCS#1 v1.5', keyHint: 'PKCS#8 private key to sign; SPKI public key, certificate or JWK to verify.' },
  { alg: 'RS512', family: 'rsa', familyLabel: 'RSA PKCS#1 v1.5', keyHint: 'PKCS#8 private key to sign; SPKI public key, certificate or JWK to verify.' },
  { alg: 'PS256', family: 'rsa-pss', familyLabel: 'RSA-PSS', keyHint: 'Same RSA keys as RS*, signed with PSS padding.' },
  { alg: 'PS384', family: 'rsa-pss', familyLabel: 'RSA-PSS', keyHint: 'Same RSA keys as RS*, signed with PSS padding.' },
  { alg: 'PS512', family: 'rsa-pss', familyLabel: 'RSA-PSS', keyHint: 'Same RSA keys as RS*, signed with PSS padding.' },
  { alg: 'ES256', family: 'ecdsa', familyLabel: 'ECDSA', keyHint: 'EC key on P-256 — the curve is fixed by the algorithm, not by the key.' },
  { alg: 'ES384', family: 'ecdsa', familyLabel: 'ECDSA', keyHint: 'EC key on P-384 — the curve is fixed by the algorithm, not by the key.' },
  { alg: 'ES512', family: 'ecdsa', familyLabel: 'ECDSA', keyHint: 'EC key on P-521 (not P-512 — the name is the hash, the curve is 521).' },
  { alg: 'EdDSA', family: 'eddsa', familyLabel: 'EdDSA', keyHint: 'Ed25519 key. Not every webview ships Ed25519 in Web Crypto — unsupported ones are greyed out.' },
  { alg: 'none', family: 'unsecured', familyLabel: 'Unsecured', keyHint: 'No key: the token carries an empty signature and proves nothing.' },
];

const BY_ALG = new Map(JWT_ALGORITHMS.map((s) => [s.alg, s]));

export function algorithmSpec(alg: string): AlgorithmSpec | undefined {
  return BY_ALG.get(alg as JwtAlgorithm);
}

export function isJwtAlgorithm(alg: string): alg is JwtAlgorithm {
  return BY_ALG.has(alg as JwtAlgorithm);
}

export function isHmac(alg: JwtAlgorithm): boolean {
  return BY_ALG.get(alg)?.family === 'hmac';
}

/** True when the algorithm signs with a private key and verifies with a public one. */
export function isAsymmetric(alg: JwtAlgorithm): boolean {
  const family = BY_ALG.get(alg)?.family;
  return family === 'rsa' || family === 'rsa-pss' || family === 'ecdsa' || family === 'eddsa';
}

// ── Secrets ────────────────────────────────────────────────────────────────

export type SecretEncoding = 'utf8' | 'base64' | 'base64url' | 'hex';

export const SECRET_ENCODINGS: { value: SecretEncoding; label: string }[] = [
  { value: 'utf8', label: 'Plain text' },
  { value: 'base64', label: 'base64' },
  { value: 'base64url', label: 'base64url' },
  { value: 'hex', label: 'hex' },
];

/**
 * A shared secret is BYTES, and how those bytes were written down changes the
 * signature completely. A secret copied out of a Kubernetes Secret or an
 * `openssl rand -base64 32` is base64 — HMAC-ing its 44 printable characters
 * instead of its 32 bytes produces a token the real service rejects, with no
 * hint as to why. Hence an explicit encoding rather than a guess.
 */
export function decodeSecret(value: string, encoding: SecretEncoding): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(value);

  if (encoding === 'hex') {
    const clean = value.replace(/\s+/g, '');
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
      throw new Error('Secret is not valid hex — expected an even number of 0-9 a-f characters.');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  let b64 = value.replace(/\s+/g, '');
  if (encoding === 'base64url') b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  b64 = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error(`Secret is not valid ${encoding}.`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Key material ───────────────────────────────────────────────────────────

export type KeyPurpose = 'sign' | 'verify';

export interface KeyInput {
  /** PEM, JWK/JWKS JSON, or a raw shared secret — whatever is in the key box. */
  material: string;
  /** Only read for HMAC algorithms. */
  encoding?: SecretEncoding;
  /** `kid` to pick out of a JWK Set; usually taken from the token's header. */
  kid?: string;
}

/** PEM types Web Crypto cannot import, with the one-liner that converts them. */
const LEGACY_PEM: { match: string; explain: string }[] = [
  {
    match: '-----BEGIN RSA PRIVATE KEY-----',
    explain: 'This is a PKCS#1 RSA key. Web Crypto only imports PKCS#8 — convert it with:\n'
      + '  openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem',
  },
  {
    match: '-----BEGIN EC PRIVATE KEY-----',
    explain: 'This is a SEC1 EC key. Web Crypto only imports PKCS#8 — convert it with:\n'
      + '  openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem',
  },
  {
    match: '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    explain: 'This private key is passphrase-encrypted. Decrypt it first:\n'
      + '  openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem',
  },
];

function pickFromJwks(parsed: unknown, alg: JwtAlgorithm, kid?: string): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const keys = (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return parsed;

  const candidates = keys as Record<string, unknown>[];
  const byKid = kid ? candidates.find((k) => k.kid === kid) : undefined;
  const byAlg = candidates.find((k) => k.alg === alg);
  const picked = byKid ?? byAlg ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!picked) {
    throw new Error(
      `This JWK Set has ${candidates.length} keys and none matches`
      + `${kid ? ` kid "${kid}" or` : ''} alg ${alg} — paste the single JWK you want instead.`,
    );
  }
  return picked;
}

/**
 * Turn whatever is in the key box into something `jose` can sign or verify
 * with, or throw an error that says what to paste instead.
 */
export async function resolveKey(input: KeyInput, alg: JwtAlgorithm, purpose: KeyPurpose) {
  const material = input.material.trim();
  if (!material) {
    throw new Error(isHmac(alg) ? 'Enter the shared secret.' : `Paste the ${purpose === 'sign' ? 'private' : 'public'} key.`);
  }

  if (isHmac(alg)) {
    const bytes = decodeSecret(material, input.encoding ?? 'utf8');
    if (bytes.length === 0) throw new Error('The secret decoded to zero bytes.');
    return bytes;
  }

  if (material.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(material);
    } catch {
      throw new Error('Key looks like JSON (JWK) but does not parse.');
    }
    const jwk = pickFromJwks(parsed, alg, input.kid) as JWK;
    if (purpose === 'sign' && !jwk.d) {
      throw new Error('This JWK has no "d" — it is a public key, which cannot sign.');
    }
    return importJWK(jwk, alg);
  }

  const legacy = LEGACY_PEM.find((l) => material.includes(l.match));
  if (legacy) throw new Error(legacy.explain);

  if (purpose === 'sign') {
    if (!material.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Signing needs a PKCS#8 private key ("-----BEGIN PRIVATE KEY-----") or a private JWK.');
    }
    return importPKCS8(material, alg);
  }

  if (material.includes('-----BEGIN CERTIFICATE-----')) return importX509(material, alg);
  if (material.includes('-----BEGIN PUBLIC KEY-----')) return importSPKI(material, alg);
  throw new Error('Verifying needs an SPKI public key ("-----BEGIN PUBLIC KEY-----"), an X.509 certificate, or a JWK.');
}

// ── Algorithm availability ─────────────────────────────────────────────────

const supportCache = new Map<JwtAlgorithm, Promise<boolean>>();

/**
 * Whether THIS webview can do the algorithm at all.
 *
 * Web Crypto coverage is not uniform: Ed25519 (EdDSA) landed in WebKit,
 * Chromium and Gecko at very different times, so the same build of this app
 * can offer it on one desktop and not on another. Asking the engine beats
 * shipping a table that is wrong somewhere — and beats a signing button that
 * fails with "Unrecognized name" after the user has pasted a key.
 */
export function isAlgorithmSupported(alg: JwtAlgorithm): Promise<boolean> {
  if (isHmac(alg) || alg === 'none') return Promise.resolve(true);
  const cached = supportCache.get(alg);
  if (cached) return cached;
  const probe = generateKeyPair(alg, { extractable: true }).then(() => true, () => false);
  supportCache.set(alg, probe);
  return probe;
}

/** Fresh key pair as PEM, so the tool is usable without hunting for a key first. */
export async function generateKeyPairPem(alg: JwtAlgorithm): Promise<{ privateKey: string; publicKey: string }> {
  if (!isAsymmetric(alg)) throw new Error(`${alg} does not use a key pair.`);
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  return { privateKey: await exportPKCS8(privateKey), publicKey: await exportSPKI(publicKey) };
}

// ── Decode ─────────────────────────────────────────────────────────────────

export interface DecodedToken {
  header: Record<string, unknown>;
  payload: JWTPayload;
  /** Base64url signature segment, empty for an unsecured token. */
  signature: string;
}

export function decodeToken(token: string): DecodedToken {
  const trimmed = token.trim();
  return {
    header: decodeProtectedHeader(trimmed) as Record<string, unknown>,
    payload: decodeJwt(trimmed),
    signature: trimmed.split('.')[2] ?? '',
  };
}

export type ClaimTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface ClaimRow {
  claim: string;
  label: string;
  value: string;
  /** Absolute time plus "in 3 minutes" / "12 days ago" for the time claims. */
  detail?: string;
  tone: ClaimTone;
}

function formatRelative(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const units: [number, string][] = [
    [86_400_000, 'day'], [3_600_000, 'hour'], [60_000, 'minute'], [1000, 'second'],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      return deltaMs < 0 ? `${n} ${name}${n === 1 ? '' : 's'} ago` : `in ${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return 'just now';
}

function timeRow(claim: string, label: string, seconds: unknown, now: number, tone: (deltaMs: number) => ClaimTone): ClaimRow | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const when = seconds * 1000;
  return {
    claim,
    label,
    value: new Date(when).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'),
    detail: formatRelative(when - now),
    tone: tone(when - now),
  };
}

export interface ClaimInspection {
  rows: ClaimRow[];
  expired: boolean;
  notYetValid: boolean;
}

/**
 * The registered claims, rendered as time rather than as Unix seconds.
 *
 * "Is this token expired?" is the single most common reason to open a JWT,
 * and `exp: 1758604262` does not answer it. This is presentation only — it
 * never decides whether a token is valid; `verifyToken` does that.
 */
export function inspectClaims(payload: JWTPayload, now: number = Date.now()): ClaimInspection {
  const rows: ClaimRow[] = [];
  const exp = timeRow('exp', 'Expires', payload.exp, now, (d) => (d <= 0 ? 'bad' : d < 300_000 ? 'warn' : 'ok'));
  const nbf = timeRow('nbf', 'Not before', payload.nbf, now, (d) => (d > 0 ? 'warn' : 'ok'));
  const iat = timeRow('iat', 'Issued at', payload.iat, now, () => 'neutral');
  for (const row of [exp, nbf, iat]) if (row) rows.push(row);

  for (const [claim, label] of [['iss', 'Issuer'], ['sub', 'Subject'], ['aud', 'Audience'], ['jti', 'JWT ID']] as const) {
    const value = payload[claim];
    if (value === undefined) continue;
    rows.push({ claim, label, value: Array.isArray(value) ? value.join(', ') : String(value), tone: 'neutral' });
  }

  return {
    rows,
    expired: typeof payload.exp === 'number' && payload.exp * 1000 <= now,
    notYetValid: typeof payload.nbf === 'number' && payload.nbf * 1000 > now,
  };
}

// ── Sign ───────────────────────────────────────────────────────────────────

export interface SignInput {
  algorithm: JwtAlgorithm;
  /** Claims, as the JSON text from the editor or an object. */
  payload: string | JWTPayload;
  /** Omitted only for `none`, which signs nothing. */
  key?: KeyInput;
  /** Extra protected-header fields (kid, typ, cty…). `alg` is always overwritten. */
  header?: Record<string, unknown>;
  /** Set `iat` to now. On by default. */
  issuedAt?: boolean;
  /** jose duration ("2h", "7d") or seconds from now. Left alone when empty. */
  expiresIn?: string | number;
  notBefore?: string | number;
}

function parsePayload(payload: string | JWTPayload): JWTPayload {
  if (typeof payload !== 'string') return { ...payload };
  const text = payload.trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Payload is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Payload must be a JSON object.');
  }
  return parsed as JWTPayload;
}

// jose reads a NUMBER passed to setExpirationTime/setNotBefore as an absolute
// Unix timestamp, so `3600` would mean "expired in 1970", not "in an hour" —
// the same trap jsonwebtokenShim.ts documents. A bare number here means
// seconds from now, which is what anyone typing "3600" into a TTL box means.
function toDuration(value: string | number): string {
  if (typeof value === 'number') return `${value}s`;
  const text = value.trim();
  return /^\d+$/.test(text) ? `${text}s` : text;
}

export async function signToken(input: SignInput): Promise<string> {
  const { algorithm } = input;
  if (!isJwtAlgorithm(algorithm)) throw new Error(`Unknown algorithm "${algorithm}".`);
  const claims = parsePayload(input.payload);

  if (algorithm === 'none') {
    let unsecured = new UnsecuredJWT(claims);
    if (input.issuedAt !== false) unsecured = unsecured.setIssuedAt();
    if (input.expiresIn) unsecured = unsecured.setExpirationTime(toDuration(input.expiresIn));
    if (input.notBefore) unsecured = unsecured.setNotBefore(toDuration(input.notBefore));
    return unsecured.encode();
  }

  if (!input.key) throw new Error(`${algorithm} needs a key to sign with.`);
  const key = await resolveKey(input.key, algorithm, 'sign');
  // `alg` last: a stale `alg` left in the header box must not be able to
  // disagree with the key actually used to sign.
  let jwt = new SignJWT(claims).setProtectedHeader({ typ: 'JWT', ...input.header, alg: algorithm });
  if (input.issuedAt !== false) jwt = jwt.setIssuedAt();
  if (input.expiresIn) jwt = jwt.setExpirationTime(toDuration(input.expiresIn));
  if (input.notBefore) jwt = jwt.setNotBefore(toDuration(input.notBefore));
  return jwt.sign(key as never);
}

// ── Verify ─────────────────────────────────────────────────────────────────

export type VerifyFailure = 'format' | 'key' | 'alg' | 'signature' | 'expired' | 'nbf' | 'claim';

export interface VerifyInput {
  token: string;
  algorithm: JwtAlgorithm;
  key: KeyInput;
  /** Optional registered-claim checks, skipped when empty. */
  issuer?: string;
  audience?: string;
  subject?: string;
  clockToleranceSec?: number;
}

export interface VerifyOutcome {
  valid: boolean;
  /** Why it failed. Absent when valid. */
  code?: VerifyFailure;
  message: string;
  header?: Record<string, unknown>;
  payload?: JWTPayload;
}

export async function verifyToken(input: VerifyInput): Promise<VerifyOutcome> {
  const token = input.token.trim();
  if (!token) return { valid: false, code: 'format', message: 'Paste a token first.' };

  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch (e) {
    return { valid: false, code: 'format', message: `Not a JWT: ${(e as Error).message}` };
  }

  // Reported, never obeyed — see the algorithm-confusion note at the top.
  if (typeof header.alg === 'string' && header.alg !== input.algorithm) {
    return {
      valid: false,
      code: 'alg',
      message: `Token header says alg "${header.alg}" but you are verifying as ${input.algorithm}. `
        + 'Pick the algorithm you expect this issuer to use — a token is never trusted to name its own.',
      header,
    };
  }

  if (input.algorithm === 'none') {
    try {
      const { payload } = UnsecuredJWT.decode(token);
      return {
        valid: false,
        code: 'signature',
        message: 'This is an unsecured token (alg "none"): it carries no signature, so nothing about it is verified.',
        header,
        payload,
      };
    } catch (e) {
      return { valid: false, code: 'format', message: (e as Error).message, header };
    }
  }

  let key: Awaited<ReturnType<typeof resolveKey>>;
  try {
    key = await resolveKey(input.key, input.algorithm, 'verify');
  } catch (e) {
    return { valid: false, code: 'key', message: (e as Error).message, header };
  }

  try {
    const { payload } = await jwtVerify(token, key as never, {
      algorithms: [input.algorithm],
      issuer: input.issuer || undefined,
      audience: input.audience || undefined,
      subject: input.subject || undefined,
      clockTolerance: input.clockToleranceSec,
    });
    return { valid: true, message: 'Signature is valid and every claim checked passed.', header, payload };
  } catch (e) {
    const payload = (e as { payload?: JWTPayload }).payload;
    if (e instanceof joseErrors.JWTExpired) {
      return { valid: false, code: 'expired', message: 'Signature is valid, but the token has expired (exp is in the past).', header, payload };
    }
    if (e instanceof joseErrors.JWTClaimValidationFailed) {
      const code: VerifyFailure = e.claim === 'nbf' ? 'nbf' : 'claim';
      return { valid: false, code, message: e.message, header, payload };
    }
    if (e instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { valid: false, code: 'signature', message: 'Signature does not match — wrong key, or the token was altered.', header };
    }
    return { valid: false, code: 'key', message: (e as Error).message || 'Verification failed.', header };
  }
}
