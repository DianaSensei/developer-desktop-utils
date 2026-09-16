import { ShieldCheck } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: '2fa',
  label: "2FA Authenticator",
  icon: ShieldCheck,
  description:
    "Generate TOTP and HOTP one-time passwords supporting SHA-1/256/512, 6/8 digits, and 30/60-second periods.",
  keywords: ["2fa", "mfa", "totp", "hotp", "otp", "authenticator", "one-time password", "google authenticator", "verification code"],
  route: '/2fa',
  order: 260,
  defaultEnabled: true,
  permissions: ['secrets', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/TwoFactorAuth').then((m) => m.TwoFactorAuth),
});
