import { KeyRound } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'jwt',
  label: "JWT Debugger",
  icon: KeyRound,
  description:
    "Decode, verify and sign JWTs — HMAC, RSA, RSA-PSS, ECDSA and EdDSA, with PEM, JWK or JWK Set keys.",
  keywords: [
    "jwt", "token", "decode", "verify", "sign", "signature", "header", "payload", "claims",
    "bearer", "auth", "jws", "jwk", "jwks", "hmac", "hs256", "rs256", "ps256", "es256", "eddsa",
    "ed25519", "pem", "pkcs8", "spki", "exp", "expired",
  ],
  route: '/jwt',
  order: 220,
  defaultEnabled: false,
  permissions: ['storage', 'secrets', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/jwt/JwtDebugger').then((m) => m.JwtDebugger),
});
