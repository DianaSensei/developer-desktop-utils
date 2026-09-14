import { Binary } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'base64',
  label: "Encode·Hash·Encrypt",
  icon: Binary,
  description:
    "Encode/decode (Base64, URL, Hex, Morse…), image↔Base64, hash text or files (MD5, SHA, HMAC, checksums), password hashing (bcrypt/Argon2), and AES-256 encrypt/decrypt.",
  keywords: ["base64", "encode", "decode", "url encode", "hex", "morse", "hash", "md5", "sha1", "sha256", "sha512", "hmac", "checksum", "crc", "bcrypt", "argon2", "aes", "encrypt", "decrypt", "cipher", "password"],
  route: '/base64',
  order: 110,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['hash_file', 'read_file_data_url'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/EncodeHashEncrypt').then((m) => m.EncodeHashEncrypt),
});
