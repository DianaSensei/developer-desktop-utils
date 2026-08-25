// Cryptographically secure random primitives for the Generator tool.
//
// The tool's own guide (`toolGuides.tsx`) promises "cryptographically secure
// randomness (crypto.getRandomValues)", and people do reach for a dev-tool
// generator when they need a throwaway password, an API key, or a PIN. So the
// promise has to hold for every mode, and the draws have to be uniform:
// `getRandomValues(...)[i] % n` is only uniform when `n` divides the generator
// range, which for an alphabet or an arbitrary min/max it almost never does.
// Both helpers below therefore resample the rare draws that fall in the
// unusable tail rather than folding them back in and skewing the low values.

/**
 * Uniform integer in `[0, bound)` — unbiased for any `bound` up to 2^32.
 *
 * Draws 32 bits and rejects the top partial bucket, so every value is equally
 * likely. The rejection probability is below 2^-32 per extra draw for the
 * alphabet sizes this is used with, so the loop effectively never runs twice.
 */
export function randomBelow(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError('bound must be a positive integer');
  }
  if (bound === 1) return 0;
  const RANGE = 2 ** 32;
  // Largest multiple of `bound` that fits in 32 bits; draws at or above it are
  // the biased tail and get thrown away.
  const limit = RANGE - (RANGE % bound);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % bound;
  }
}

/**
 * Uniform integer in `[min, max]`, both ends inclusive.
 */
export function randomInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi < lo) return lo;
  return lo + randomBelow(hi - lo + 1);
}

/**
 * Uniform float in `[0, 1)` with all 53 bits of a double's mantissa, so no
 * representable value in the interval is unreachable — the drop-in replacement
 * for `Math.random()` where the result feeds a real number range.
 */
export function randomUnitFloat(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 26 high bits + 27 low bits = 53.
  return ((buf[0] >>> 5) * 2 ** 26 + (buf[1] >>> 6)) / 2 ** 53;
}

/**
 * Pick `length` characters uniformly from `charset`.
 *
 * `charset` is split by code point rather than by UTF-16 unit so a custom
 * character set containing an emoji or an astral-plane symbol produces whole
 * characters instead of lone surrogates.
 */
export function randomString(length: number, charset: string): string {
  const chars = Array.from(charset);
  if (!chars.length || length <= 0) return '';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[randomBelow(chars.length)];
  return out;
}
