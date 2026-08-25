// Passphrase encryption that is actually strong, for the Encrypt tab.
//
// The other modes in that tool go through `crypto-js`, which is the point of
// them: they exist so you can decrypt what a `crypto-js` caller produced, and
// produce what one can read back. But `crypto-js`'s passphrase mode derives its
// key with OpenSSL's EvpKDF — **MD5, one iteration**, over an 8-byte salt — and
// none of its modes authenticate the ciphertext. A guess at your passphrase
// therefore costs an attacker a single MD5, and anyone holding the ciphertext
// can flip bits in the plaintext without being detected.
//
// So there is one mode that does not use crypto-js at all. This one:
//
//   PBKDF2-HMAC-SHA256 (600k iterations, OWASP 2023) → AES-256-GCM
//
// via WebCrypto, with a fresh 16-byte salt and 12-byte IV per message. GCM's
// tag makes a wrong key or a tampered ciphertext a decryption *failure* rather
// than plausible-looking garbage.
//
// Envelope (base64 of): "DTv1" ‖ iterations (uint32 BE) ‖ salt(16) ‖ iv(12) ‖
// ciphertext‖tag. The iteration count travels with the message, so raising the
// default later does not strand ciphertexts written before the change.

const MAGIC = 'DTv1';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 4 + 4 + SALT_BYTES + IV_BYTES;

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;

/** Ciphertext this format cannot have produced. */
export class EnvelopeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeFormatError';
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error('WebCrypto is unavailable in this environment.');
  return c;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  // Chunked so a large message doesn't blow the argument limit of `apply`.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptAesGcm(
  plaintext: string,
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );

  const out = new Uint8Array(HEADER_BYTES + ct.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, iterations, false);
  out.set(salt, 8);
  out.set(iv, 8 + SALT_BYTES);
  out.set(ct, HEADER_BYTES);
  return toBase64(out);
}

export async function decryptAesGcm(envelope: string, passphrase: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(envelope.trim());
  } catch {
    throw new EnvelopeFormatError('That is not valid base64.');
  }
  if (bytes.length <= HEADER_BYTES) {
    throw new EnvelopeFormatError('Ciphertext is too short to be an AES-GCM message.');
  }
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new EnvelopeFormatError(
      'Not an AES-256-GCM message from this tool. Pick the crypto-js mode it was written with.',
    );
  }

  const iterations = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, false);
  if (iterations < 1 || iterations > 10_000_000) {
    throw new EnvelopeFormatError('Ciphertext header is corrupt (implausible iteration count).');
  }
  const salt = bytes.subarray(8, 8 + SALT_BYTES);
  const iv = bytes.subarray(8 + SALT_BYTES, HEADER_BYTES);
  const ct = bytes.subarray(HEADER_BYTES);

  const key = await deriveKey(passphrase, salt, iterations);
  // A wrong passphrase and a tampered message are the same failure here, which
  // is the property GCM is for — neither yields plausible-looking plaintext.
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(plain);
}

/** Does this look like an envelope this module wrote? Used to steer error copy. */
export function isAesGcmEnvelope(value: string): boolean {
  try {
    const bytes = fromBase64(value.trim());
    return bytes.length > HEADER_BYTES
      && new TextDecoder().decode(bytes.subarray(0, 4)) === MAGIC;
  } catch {
    return false;
  }
}
