// Key generation — pure, async, no React.
//
// Everything runs on the webview's own Web Crypto with a CSPRNG; nothing is
// sent anywhere. Output formats are the ones people actually paste
// somewhere else:
//
//   PEM      PKCS#8 private / SPKI public — OpenSSL, JVM, Node, Go, jose
//   JWK      single keys and a public JWK Set (kid = RFC 7638 thumbprint)
//   OpenSSH  `ssh-ed25519 …` / `ssh-rsa …` / `ecdsa-sha2-…` public lines and
//            an unencrypted `openssh-key-v1` private key, as ssh-keygen writes
//   raw      base64 / hex bytes for secrets and WireGuard (X25519) keys
//
// OpenSSH private keys are written unencrypted (cipher "none"), exactly like
// `ssh-keygen -N ""`. Add a passphrase afterwards with `ssh-keygen -p -f key`.

import { calculateJwkThumbprint, type JWK } from 'jose';

// ─── Presets ───────────────────────────────────────────────────────────────────

export type KeyPresetId =
  | 'rsa-2048' | 'rsa-3072' | 'rsa-4096'
  | 'ec-p256' | 'ec-p384' | 'ec-p521'
  | 'ed25519' | 'x25519'
  | 'hmac-256' | 'hmac-384' | 'hmac-512'
  | 'aes-128' | 'aes-256'
  | 'random';

export type KeyKind = 'pair' | 'secret';

export interface KeyPreset {
  id: KeyPresetId;
  kind: KeyKind;
  label: string;
  // What each preset is for is shown from messages (`keygen.uses.<id>`).
  /** JOSE `alg` for the JWK output, when the key has one. */
  jwsAlg?: string;
  /** OpenSSH can hold this key type. */
  ssh?: boolean;
  /** Secret length in bytes. */
  bytes?: number;
}

export const KEY_PRESETS: KeyPreset[] = [
  { id: 'ed25519', kind: 'pair', label: 'Ed25519', jwsAlg: 'EdDSA', ssh: true },
  { id: 'rsa-2048', kind: 'pair', label: 'RSA 2048', jwsAlg: 'RS256', ssh: true },
  { id: 'rsa-3072', kind: 'pair', label: 'RSA 3072', jwsAlg: 'RS256', ssh: true },
  { id: 'rsa-4096', kind: 'pair', label: 'RSA 4096', jwsAlg: 'RS256', ssh: true },
  { id: 'ec-p256', kind: 'pair', label: 'EC P-256', jwsAlg: 'ES256', ssh: true },
  { id: 'ec-p384', kind: 'pair', label: 'EC P-384', jwsAlg: 'ES384', ssh: true },
  { id: 'ec-p521', kind: 'pair', label: 'EC P-521', jwsAlg: 'ES512', ssh: true },
  { id: 'x25519', kind: 'pair', label: 'X25519' },
  { id: 'hmac-256', kind: 'secret', label: 'HMAC secret 256-bit', bytes: 32 },
  { id: 'hmac-384', kind: 'secret', label: 'HMAC secret 384-bit', bytes: 48 },
  { id: 'hmac-512', kind: 'secret', label: 'HMAC secret 512-bit', bytes: 64 },
  { id: 'aes-128', kind: 'secret', label: 'AES-128 key', bytes: 16 },
  { id: 'aes-256', kind: 'secret', label: 'AES-256 key', bytes: 32 },
  { id: 'random', kind: 'secret', label: 'Random bytes', bytes: 32 },
];

export const presetById = (id: KeyPresetId) => KEY_PRESETS.find((p) => p.id === id)!;

// ─── Byte helpers ──────────────────────────────────────────────────────────────

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto is unavailable in this environment.');
  return s;
};

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function pem(label: string, der: Uint8Array, width = 64): string {
  const body = toBase64(der).match(new RegExp(`.{1,${width}}`, 'g'))!.join('\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

// ─── SSH wire format (RFC 4251 §5) ─────────────────────────────────────────────

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const sshString = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return concat(u32(bytes.length), bytes);
};
/** Unsigned big-endian integer as an SSH mpint: no leading zeros, a 0x00 pad when the top bit is set. */
function sshMpint(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  let v = bytes.subarray(i);
  if (v.length === 1 && v[0] === 0) v = new Uint8Array(0);
  if (v.length > 0 && v[0] & 0x80) v = concat(new Uint8Array([0]), v);
  return sshString(v);
}

const SSH_EC: Record<string, { type: string; curve: string }> = {
  'P-256': { type: 'ecdsa-sha2-nistp256', curve: 'nistp256' },
  'P-384': { type: 'ecdsa-sha2-nistp384', curve: 'nistp384' },
  'P-521': { type: 'ecdsa-sha2-nistp521', curve: 'nistp521' },
};

/** SSH public key blob and the private-section body for a key, from its private JWK. */
function sshParts(jwk: JWK): { type: string; pub: Uint8Array; priv: Uint8Array } {
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    const pub = fromBase64Url(jwk.x!);
    const seed = fromBase64Url(jwk.d!);
    const type = 'ssh-ed25519';
    return {
      type,
      pub: concat(sshString(type), sshString(pub)),
      // OpenSSH stores the 64-byte "secret key": seed ‖ public key.
      priv: concat(sshString(type), sshString(pub), sshString(concat(seed, pub))),
    };
  }
  if (jwk.kty === 'RSA') {
    const [n, e, d, p, q, qi] = [jwk.n, jwk.e, jwk.d, jwk.p, jwk.q, jwk.qi].map((v) => fromBase64Url(v!));
    const type = 'ssh-rsa';
    return {
      type,
      pub: concat(sshString(type), sshMpint(e), sshMpint(n)),
      priv: concat(sshString(type), sshMpint(n), sshMpint(e), sshMpint(d), sshMpint(qi), sshMpint(p), sshMpint(q)),
    };
  }
  if (jwk.kty === 'EC' && jwk.crv && SSH_EC[jwk.crv]) {
    const { type, curve } = SSH_EC[jwk.crv];
    const q = concat(new Uint8Array([4]), fromBase64Url(jwk.x!), fromBase64Url(jwk.y!));
    return {
      type,
      pub: concat(sshString(type), sshString(curve), sshString(q)),
      priv: concat(sshString(type), sshString(curve), sshString(q), sshMpint(fromBase64Url(jwk.d!))),
    };
  }
  throw new Error(`OpenSSH has no format for this key (${jwk.kty} ${jwk.crv ?? ''}).`);
}

/** `ssh-keygen -l` style fingerprint: SHA256 of the public blob, unpadded base64. */
async function sshFingerprint(pubBlob: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', pubBlob as BufferSource));
  return `SHA256:${toBase64(digest).replace(/=+$/, '')}`;
}

/** Unencrypted `openssh-key-v1` private key (PROTOCOL.key), as `ssh-keygen -N ""` writes. */
function opensshPrivateKey(pub: Uint8Array, privBody: Uint8Array, comment: string): string {
  const check = crypto.getRandomValues(new Uint8Array(4));
  let section = concat(check, check, privBody, sshString(comment));
  const pad = (8 - (section.length % 8)) % 8;
  section = concat(section, Uint8Array.from({ length: pad }, (_, i) => i + 1));
  const blob = concat(
    new TextEncoder().encode('openssh-key-v1\0'),
    sshString('none'), sshString('none'), sshString(new Uint8Array(0)),
    u32(1), sshString(pub), sshString(section),
  );
  return pem('OPENSSH PRIVATE KEY', blob, 70);
}

// ─── Generation ────────────────────────────────────────────────────────────────

export interface KeyPairResult {
  kind: 'pair';
  preset: KeyPresetId;
  privatePem: string;
  publicPem: string;
  privateJwk: JWK;
  publicJwk: JWK;
  /** `{ "keys": [publicJwk] }` — what a JWKS endpoint serves. */
  jwks: string;
  /** RFC 7638 thumbprint, used as `kid`. */
  kid: string;
  ssh?: { publicKey: string; privateKey: string; fingerprint: string };
  /** X25519 only: raw 32-byte keys in base64, as WireGuard writes them. */
  wireguard?: { privateKey: string; publicKey: string };
}

export interface SecretResult {
  kind: 'secret';
  preset: KeyPresetId;
  bytes: number;
  hex: string;
  base64: string;
  base64url: string;
  /** Symmetric JWK (`kty: "oct"`), for HMAC and AES presets. */
  jwk?: JWK;
}

export type KeyResult = KeyPairResult | SecretResult;

export interface GenerateOptions {
  /** OpenSSH comment, e.g. `user@host`. */
  comment?: string;
  /** Length for the `random` preset (1–1024 bytes). */
  bytes?: number;
}

function algorithmFor(id: KeyPresetId): { params: RsaHashedKeyGenParams | EcKeyGenParams | Algorithm; usages: KeyUsage[] } {
  switch (id) {
    case 'rsa-2048': case 'rsa-3072': case 'rsa-4096':
      return {
        params: { name: 'RSASSA-PKCS1-v1_5', modulusLength: Number(id.slice(4)), publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        usages: ['sign', 'verify'],
      };
    case 'ec-p256': return { params: { name: 'ECDSA', namedCurve: 'P-256' }, usages: ['sign', 'verify'] };
    case 'ec-p384': return { params: { name: 'ECDSA', namedCurve: 'P-384' }, usages: ['sign', 'verify'] };
    case 'ec-p521': return { params: { name: 'ECDSA', namedCurve: 'P-521' }, usages: ['sign', 'verify'] };
    case 'ed25519': return { params: { name: 'Ed25519' }, usages: ['sign', 'verify'] };
    case 'x25519': return { params: { name: 'X25519' }, usages: ['deriveBits'] };
    default: throw new Error(`${id} is not a key pair.`);
  }
}

const supportCache = new Map<KeyPresetId, Promise<boolean>>();

/**
 * Whether this webview can generate the preset. Ed25519 / X25519 arrived in
 * WebKit, Chromium and Gecko at different times, so ask the engine rather
 * than ship a table that is wrong somewhere.
 */
export function isPresetSupported(id: KeyPresetId): Promise<boolean> {
  if (presetById(id).kind === 'secret' || id.startsWith('rsa') || id.startsWith('ec')) return Promise.resolve(true);
  let probe = supportCache.get(id);
  if (!probe) {
    const { params, usages } = algorithmFor(id);
    probe = Promise.resolve()
      .then(() => subtle().generateKey(params, false, usages))
      .then(() => true, () => false);
    supportCache.set(id, probe);
  }
  return probe;
}

export async function generateKey(id: KeyPresetId, opts: GenerateOptions = {}): Promise<KeyResult> {
  const preset = presetById(id);
  if (preset.kind === 'secret') return generateSecret(preset, opts);

  const { params, usages } = algorithmFor(id);
  let pair: CryptoKeyPair;
  try {
    pair = (await subtle().generateKey(params, true, usages)) as CryptoKeyPair;
  } catch {
    throw new Error(`${preset.label} is not supported by this system's Web Crypto.`);
  }
  const [pkcs8, spki, privateJwk, publicJwk] = await Promise.all([
    subtle().exportKey('pkcs8', pair.privateKey),
    subtle().exportKey('spki', pair.publicKey),
    subtle().exportKey('jwk', pair.privateKey) as Promise<JWK>,
    subtle().exportKey('jwk', pair.publicKey) as Promise<JWK>,
  ]);

  // Web Crypto adds `key_ops` / `ext`, which a JWKS should not carry.
  const clean = ({ key_ops: _ops, ext: _ext, alg: _alg, ...rest }: JWK & { key_ops?: unknown; ext?: unknown }): JWK => rest;
  const pubJwk = clean(publicJwk);
  const kid = await calculateJwkThumbprint(pubJwk);
  const meta: JWK = { kid, ...(preset.jwsAlg ? { alg: preset.jwsAlg, use: 'sig' } : { use: 'enc' }) };
  const result: KeyPairResult = {
    kind: 'pair',
    preset: id,
    privatePem: pem('PRIVATE KEY', new Uint8Array(pkcs8)),
    publicPem: pem('PUBLIC KEY', new Uint8Array(spki)),
    privateJwk: { ...clean(privateJwk), ...meta },
    publicJwk: { ...pubJwk, ...meta },
    jwks: JSON.stringify({ keys: [{ ...pubJwk, ...meta }] }, null, 2),
    kid,
  };

  if (preset.ssh) {
    const comment = opts.comment?.trim() ?? '';
    const { type, pub, priv } = sshParts(privateJwk);
    result.ssh = {
      publicKey: `${type} ${toBase64(pub)}${comment ? ` ${comment}` : ''}`,
      privateKey: opensshPrivateKey(pub, priv, comment),
      fingerprint: await sshFingerprint(pub),
    };
  }
  if (id === 'x25519') {
    result.wireguard = {
      privateKey: toBase64(fromBase64Url(privateJwk.d!)),
      publicKey: toBase64(fromBase64Url(publicJwk.x!)),
    };
  }
  return result;
}

function generateSecret(preset: KeyPreset, opts: GenerateOptions): SecretResult {
  const n = preset.id === 'random' ? Math.trunc(opts.bytes ?? preset.bytes ?? 32) : preset.bytes!;
  if (!(n >= 1 && n <= 1024)) throw new Error('Length must be between 1 and 1024 bytes.');
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  const k = toBase64Url(bytes);
  const jwk: JWK | undefined =
    preset.id.startsWith('hmac') ? { kty: 'oct', k, alg: `HS${preset.id.slice(5)}`, use: 'sig' }
    : preset.id.startsWith('aes') ? { kty: 'oct', k, alg: `A${preset.id.slice(4)}GCM`, use: 'enc' }
    : undefined;
  return { kind: 'secret', preset: preset.id, bytes: n, hex: toHex(bytes), base64: toBase64(bytes), base64url: k, jwk };
}
