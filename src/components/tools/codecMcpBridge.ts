// MCP bridge — Encode·Hash·Encrypt tool (`base64`). Every operation here is a
// pure function of its arguments — no persisted app state is read or
// written, unlike the connection-based tools (API Client, Mock Server,
// Redis/Kafka/RabbitMQ/Container Clients). That means there's no "on
// screen" requirement and no race to avoid: this bridge is mounted once,
// unconditionally, at the app root (McpUtilityBridge.tsx) — the same
// listener answers whether the tool is open, closed, or the app is on a
// completely different screen. The only gate is the per-tool MCP toggle
// (Settings → MCP → Per-tool MCP access, `codec_*`/`hash_*`/`encrypt_*`/
// `decrypt_text` all live under the `base64` tool id there).
//
// Reuses the exact codec/hash/encrypt tables and functions
// EncodeHashEncrypt.tsx itself renders from (CODECS, ALGORITHMS,
// computeHash, computeHmac, ENCRYPT_ALGOS, doEncrypt, doDecrypt — all
// exported from that file for this purpose) plus `lib/aesGcm.ts`'s
// WebCrypto AES-256-GCM path, so there is exactly one implementation of
// each algorithm, not a second copy for MCP.
//
// A caller supplies its own key/passphrase per call — nothing here ever
// reads the tool's own persisted `devtool:hash:key`/`devtool:hash:hmacKey`
// fields, so (unlike the Vault-style exclusions elsewhere in this repo)
// there is no separate "secret store" this bridge could leak.

import {
  ALGORITHMS, CODECS, ENCRYPT_ALGOS, HMAC_ALGORITHMS,
  computeHash, computeHmac, doDecrypt, doEncrypt,
  type AlgoId, type CryptoJsAlgo, type EncryptAlgo,
} from './EncodeHashEncrypt';
import { decryptAesGcm, encryptAesGcm } from '@/lib/aesGcm';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

function requireCodec(id: string) {
  const codec = CODECS.find((c) => c.id === id);
  if (!codec) throw new Error(`Unknown codec "${id}" — one of ${CODECS.map((c) => c.id).join(', ')}`);
  return codec;
}

function requireHashAlgo(id: string): AlgoId {
  const algo = ALGORITHMS.find((a) => a.id === id);
  if (!algo) throw new Error(`Unknown hash algorithm "${id}" — one of ${ALGORITHMS.map((a) => a.id).join(', ')}`);
  return algo.id;
}

function requireHmacAlgo(id: string): AlgoId {
  const algo = HMAC_ALGORITHMS.find((a) => a.id === id);
  if (!algo) throw new Error(`Unknown HMAC algorithm "${id}" — one of ${HMAC_ALGORITHMS.map((a) => a.id).join(', ')}`);
  return algo.id;
}

function requireEncryptAlgo(id: string): EncryptAlgo {
  const algo = ENCRYPT_ALGOS.find((a) => a.id === id);
  if (!algo) throw new Error(`Unknown encryption algorithm "${id}" — one of ${ENCRYPT_ALGOS.map((a) => a.id).join(', ')}`);
  return algo.id;
}

export function buildCodecHandlers(): Record<string, ToolHandler> {
  return {
    codec_encode: async (args) => {
      const codec = requireCodec(requireString(args.algorithm, 'algorithm'));
      return { output: codec.encode(requireString(args.text, 'text')) };
    },

    codec_decode: async (args) => {
      const codec = requireCodec(requireString(args.algorithm, 'algorithm'));
      return { output: codec.decode(requireString(args.text, 'text')) };
    },

    // Omit `algorithm` to get every hash at once (same as the UI, which
    // always computes all 9 in parallel) — pass it to get just one.
    hash_compute: async (args) => {
      const text = requireString(args.text, 'text');
      const upperHex = args.upperHex === true;
      const format = (v: string) => (upperHex ? v.toUpperCase() : v);
      if (typeof args.algorithm === 'string' && args.algorithm) {
        const id = requireHashAlgo(args.algorithm);
        return { algorithm: id, hash: format(computeHash(id, text)) };
      }
      return Object.fromEntries(ALGORITHMS.map(({ id }) => [id, format(computeHash(id, text))]));
    },

    hash_hmac: async (args) => {
      const id = requireHmacAlgo(requireString(args.algorithm, 'algorithm'));
      const text = requireString(args.text, 'text');
      const key = requireString(args.key, 'key');
      const upperHex = args.upperHex === true;
      const hmac = computeHmac(id, text, key);
      return { algorithm: id, hmac: upperHex ? hmac.toUpperCase() : hmac };
    },

    encrypt_text: async (args) => {
      const algo = requireEncryptAlgo(requireString(args.algorithm, 'algorithm'));
      const text = requireString(args.text, 'text');
      const key = requireString(args.key, 'key');
      const output = algo === 'aes-gcm'
        ? await encryptAesGcm(text, key)
        : doEncrypt(algo as CryptoJsAlgo, text, key);
      return { algorithm: algo, output };
    },

    decrypt_text: async (args) => {
      const algo = requireEncryptAlgo(requireString(args.algorithm, 'algorithm'));
      const ciphertext = requireString(args.ciphertext, 'ciphertext');
      const key = requireString(args.key, 'key');
      if (algo === 'aes-gcm') {
        return { algorithm: algo, output: await decryptAesGcm(ciphertext, key) };
      }
      // crypto-js doesn't throw on a wrong key/malformed ciphertext for most
      // modes — it silently produces an empty string, same signal
      // EncodeHashEncrypt.tsx's own Decrypt tab checks for.
      const output = doDecrypt(algo as CryptoJsAlgo, ciphertext, key);
      if (!output) throw new Error('Invalid key or ciphertext');
      return { algorithm: algo, output };
    },
  };
}
