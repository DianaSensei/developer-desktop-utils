// SHA-3 as standardised in FIPS 202. crypto-js's `SHA3` is the original
// Keccak submission: the same sponge, but its padding starts with the byte
// 0x01, where FIPS 202 appends the domain bits `01` first (byte 0x06). So
// CryptoJS.SHA3('') is Keccak-256 `c5d24601…`, not SHA3-256 `a7ffc6f8…`.
// This hasher reuses crypto-js's permutation and changes only that byte.

import CryptoJS from 'crypto-js';

interface Lane { high: number; low: number }
interface Sha3Internals {
  _data: CryptoJS.lib.WordArray;
  _state: Lane[];
  _process(): void;
  blockSize: number;
  cfg: { outputLength: number };
}

const swapEndian = (w: number) => (((w << 8) | (w >>> 24)) & 0x00ff00ff) | (((w << 24) | (w >>> 8)) & 0xff00ff00);

// crypto-js's own `_doFinalize` (sha3.js), with the FIPS 202 domain byte.
const FipsSha3 = (CryptoJS.algo.SHA3 as unknown as { extend(overrides: object): { create(cfg: object): { finalize(message: string): CryptoJS.lib.WordArray } } }).extend({
  _doFinalize(this: Sha3Internals) {
    const data = this._data;
    const dataWords = data.words;
    const nBitsLeft = data.sigBytes * 8;
    const blockSizeBits = this.blockSize * 32;

    dataWords[nBitsLeft >>> 5] |= 0x06 << (24 - (nBitsLeft % 32));
    dataWords[((Math.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits) >>> 5) - 1] |= 0x80;
    data.sigBytes = dataWords.length * 4;
    this._process();

    const outputLengthBytes = this.cfg.outputLength / 8;
    const hashWords: number[] = [];
    for (let i = 0; i < outputLengthBytes / 8; i++) {
      const lane = this._state[i];
      hashWords.push(swapEndian(lane.low), swapEndian(lane.high));
    }
    return CryptoJS.lib.WordArray.create(hashWords, outputLengthBytes);
  },
});

/** FIPS 202 SHA3-256 / SHA3-512 of a UTF-8 string, as lowercase hex. */
export function sha3Hex(input: string, bits: 256 | 512): string {
  return FipsSha3.create({ outputLength: bits }).finalize(input).toString();
}
