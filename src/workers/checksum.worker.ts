import CryptoJS from 'crypto-js';

type AlgoId = 'md5' | 'sha1' | 'sha256' | 'sha512';

// 4 MB per chunk — keeps memory flat regardless of file size
const CHUNK_SIZE = 4 * 1024 * 1024;

function createHasher(algo: AlgoId) {
  switch (algo) {
    case 'md5':    return CryptoJS.algo.MD5.create();
    case 'sha1':   return CryptoJS.algo.SHA1.create();
    case 'sha256': return CryptoJS.algo.SHA256.create();
    case 'sha512': return CryptoJS.algo.SHA512.create();
  }
}

function toWordArray(ab: ArrayBuffer): CryptoJS.lib.WordArray {
  const u8 = new Uint8Array(ab);
  const words: number[] = [];
  for (let i = 0; i < u8.length; i += 4) {
    words.push(
      ((u8[i] ?? 0) << 24) | ((u8[i + 1] ?? 0) << 16) | ((u8[i + 2] ?? 0) << 8) | (u8[i + 3] ?? 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words as unknown as number[], u8.length);
}

self.onmessage = async ({ data }: MessageEvent<{ file: File; algo: AlgoId }>) => {
  try {
    const { file, algo } = data;
    const hasher = createHasher(algo);
    let offset = 0;

    while (offset < file.size) {
      const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const ab = await slice.arrayBuffer();
      hasher.update(toWordArray(ab));
      offset += ab.byteLength;
      self.postMessage({
        type: 'progress',
        percent: Math.min(99, Math.round((offset / file.size) * 100)),
      });
    }

    self.postMessage({ type: 'result', hash: hasher.finalize().toString() });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
