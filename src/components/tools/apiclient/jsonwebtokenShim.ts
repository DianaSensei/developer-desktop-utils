// `require('jsonwebtoken')` shim for API Client scripts.
//
// The real `jsonwebtoken` npm package is Node-only — it calls Node's
// `crypto`/`Buffer` directly, neither of which exist in the webview this
// app's scripts run in (Tauri's frontend is a native OS webview, not a
// Node.js process — see docs/ai/CLAUDE.md's "MCP bridge" background for the
// same Electron-vs-Tauri distinction). Importing the real package would fail
// to resolve at build time, and even if it somehow bundled, `Buffer.from`
// would throw at runtime. Postman/Bruno can bundle it because their desktop
// apps run on Electron, which really is backed by a Node.js process; DevTool
// has no such process behind its webview.
//
// This module reimplements the common surface (sign/verify/decode) using
// `jose`, which is built entirely on the browser-native Web Crypto API
// (`crypto.subtle`) — no polyfills, works in every webview and in the plain
// web build too. It is API-compatible with real `jsonwebtoken` for the
// common cases, with two deliberate differences documented at each function:
// `sign`/`verify` are async (Web Crypto has no synchronous API, so this
// can't be helped — scripts already run inside an `async function`, so
// `await jwt.sign(...)` just works), and `verify` requires the caller to
// name the expected algorithm(s) rather than trusting the token's own `alg`
// header, which is how algorithm-confusion attacks work (a token signed
// HS256 with the RS256 public key reused as an HMAC secret, verified as if
// it were legitimately signed) — real jsonwebtoken only closes this hole if
// the caller remembers to pass `algorithms`, so this shim makes it mandatory
// instead of an easy-to-forget opt-in.

import {
  SignJWT, jwtVerify, importPKCS8, importSPKI, decodeJwt, decodeProtectedHeader,
  errors as joseErrors, type JWTPayload,
} from 'jose';

export type JwtAlgorithm =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'PS256' | 'PS384' | 'PS512'
  | 'ES256' | 'ES384' | 'ES512'
  | 'EdDSA';

export interface SignOptions {
  algorithm?: JwtAlgorithm; // default 'HS256', matching real jsonwebtoken
  expiresIn?: string | number; // number = seconds from now (NOT an absolute timestamp)
  notBefore?: string | number; // same convention as expiresIn
  issuer?: string;
  subject?: string;
  audience?: string | string[];
  jwtid?: string;
  header?: Record<string, unknown>; // merged into the protected header, after alg/typ
  noTimestamp?: boolean; // skip auto-setting "iat"
}

export interface VerifyOptions {
  // Required — see the module doc comment above for why this shim doesn't
  // fall back to trusting the token's own "alg" header.
  algorithms: JwtAlgorithm[];
  issuer?: string;
  subject?: string;
  audience?: string | string[];
  clockTolerance?: number; // seconds
  ignoreExpiration?: boolean;
  ignoreNotBefore?: boolean;
}

export interface DecodeOptions {
  complete?: boolean;
}

// jsonwebtoken-style named errors, so a script's `catch (e) { if (e.name ===
// 'TokenExpiredError') ... }` (a very common Postman/Bruno pattern) works
// unmodified against this shim.
export class JsonWebTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonWebTokenError';
  }
}
export class TokenExpiredError extends JsonWebTokenError {
  expiredAt: Date;
  constructor(message: string, expiredAt: Date) {
    super(message);
    this.name = 'TokenExpiredError';
    this.expiredAt = expiredAt;
  }
}
export class NotBeforeError extends JsonWebTokenError {
  date: Date;
  constructor(message: string, date: Date) {
    super(message);
    this.name = 'NotBeforeError';
    this.date = date;
  }
}

const HMAC_ALGORITHMS = new Set<JwtAlgorithm>(['HS256', 'HS384', 'HS512']);

function isPem(value: unknown): value is string {
  return typeof value === 'string' && value.includes('-----BEGIN');
}

function isHmac(algorithm: JwtAlgorithm): boolean {
  return HMAC_ALGORITHMS.has(algorithm);
}

// number => "Ns" so jose's own relative-duration parser computes "now + N
// seconds" — jose treats a *number* passed to setExpirationTime/
// setNotBefore as an ABSOLUTE Unix timestamp (seconds), not a duration. Real
// jsonwebtoken's `expiresIn`/`notBefore` numeric options are always a
// duration in seconds from now. Passing the number straight through would
// silently produce a token expiring in 1970 instead of in an hour — exactly
// the kind of bug that only shows up as "why does my token look expired
// immediately".
function toDuration(value: string | number): string {
  return typeof value === 'number' ? `${value}s` : value;
}

async function resolveKey(secretOrKeyPem: unknown, algorithm: JwtAlgorithm, purpose: 'sign' | 'verify') {
  if (isHmac(algorithm)) {
    if (typeof secretOrKeyPem !== 'string' && !(secretOrKeyPem instanceof Uint8Array)) {
      throw new JsonWebTokenError(`${algorithm} requires a string or Uint8Array secret, got ${typeof secretOrKeyPem}`);
    }
    return typeof secretOrKeyPem === 'string' ? new TextEncoder().encode(secretOrKeyPem) : secretOrKeyPem;
  }
  if (!isPem(secretOrKeyPem)) {
    const kind = purpose === 'sign' ? 'private key (PKCS8, "-----BEGIN PRIVATE KEY-----")' : 'public key (SPKI, "-----BEGIN PUBLIC KEY-----")';
    throw new JsonWebTokenError(`${algorithm} requires a PEM-encoded ${kind} string`);
  }
  return purpose === 'sign' ? importPKCS8(secretOrKeyPem, algorithm) : importSPKI(secretOrKeyPem, algorithm);
}

/**
 * Sign a payload into a compact JWS (JWT). Returns a Promise — Web Crypto
 * has no synchronous signing API, so unlike real jsonwebtoken's callback-less
 * form this must always be awaited.
 */
export async function sign(
  payload: Record<string, unknown> | string,
  secretOrPrivateKey: string | Uint8Array,
  options: SignOptions = {},
): Promise<string> {
  const algorithm = options.algorithm ?? 'HS256';
  const key = await resolveKey(secretOrPrivateKey, algorithm, 'sign');
  const claims: JWTPayload = typeof payload === 'string' ? { data: payload } : { ...payload };

  let jwt = new SignJWT(claims).setProtectedHeader({ ...options.header, alg: algorithm });
  if (!options.noTimestamp) jwt = jwt.setIssuedAt();
  if (options.expiresIn !== undefined) jwt = jwt.setExpirationTime(toDuration(options.expiresIn));
  if (options.notBefore !== undefined) jwt = jwt.setNotBefore(toDuration(options.notBefore));
  if (options.issuer !== undefined) jwt = jwt.setIssuer(options.issuer);
  if (options.subject !== undefined) jwt = jwt.setSubject(options.subject);
  if (options.audience !== undefined) jwt = jwt.setAudience(options.audience);
  if (options.jwtid !== undefined) jwt = jwt.setJti(options.jwtid);

  return jwt.sign(key as never);
}

/** Verify a compact JWS (JWT)'s signature and standard claims, returning the payload. */
export async function verify(
  token: string,
  secretOrPublicKey: string | Uint8Array,
  options: VerifyOptions,
): Promise<JWTPayload> {
  if (!options?.algorithms?.length) {
    throw new JsonWebTokenError(
      'verify() requires options.algorithms (e.g. { algorithms: ["HS256"] }) — the token\'s own '
      + '"alg" header is never trusted to pick the algorithm, since that is exactly how '
      + 'algorithm-confusion attacks work',
    );
  }
  const key = await resolveKey(secretOrPublicKey, options.algorithms[0], 'verify');

  try {
    const { payload } = await jwtVerify(token, key as never, {
      algorithms: options.algorithms,
      issuer: options.issuer,
      subject: options.subject,
      audience: options.audience,
      clockTolerance: options.clockTolerance,
    });
    return payload;
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired && !options.ignoreExpiration) {
      const exp = (e.payload as JWTPayload).exp;
      throw new TokenExpiredError(e.message, exp !== undefined ? new Date(exp * 1000) : new Date());
    }
    if (e instanceof joseErrors.JWTClaimValidationFailed && e.claim === 'nbf' && !options.ignoreNotBefore) {
      const nbf = (e.payload as JWTPayload).nbf;
      throw new NotBeforeError(e.message, nbf !== undefined ? new Date(nbf * 1000) : new Date());
    }
    if (e instanceof joseErrors.JOSEError) throw new JsonWebTokenError(e.message);
    throw e;
  }
}

/** Decode a JWT without verifying its signature — for inspection only, never trust the result. */
export function decode(
  token: string,
  options?: DecodeOptions,
): JWTPayload | { header: Record<string, unknown>; payload: JWTPayload; signature: string } | null {
  try {
    const payload = decodeJwt(token);
    if (!options?.complete) return payload;
    return { header: decodeProtectedHeader(token), payload, signature: token.split('.')[2] ?? '' };
  } catch {
    return null;
  }
}

export default { sign, verify, decode, JsonWebTokenError, TokenExpiredError, NotBeforeError };
