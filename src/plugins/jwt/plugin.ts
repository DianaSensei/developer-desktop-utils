import { KeyRound } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'jwt',
  label: "JWT Debugger",
  icon: KeyRound,
  description:
    "Decode and inspect JWT headers and payloads without verification.",
  keywords: ["jwt", "token", "decode", "header", "payload", "claims", "bearer", "auth"],
  route: '/jwt',
  order: 220,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/JwtDebugger').then((m) => m.JwtDebugger),
});
