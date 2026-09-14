import { CaseSensitive } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'text-transform',
  label: "Text Transformer",
  icon: CaseSensitive,
  description:
    "Change case, join/split lines, build arrays, and convert Vietnamese phone numbers.",
  keywords: ["case", "uppercase", "lowercase", "camelcase", "snake case", "kebab", "title case", "lines", "split", "join", "trim", "phone", "vietnamese"],
  route: '/text-transform',
  order: 70,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/TextTransformer').then((m) => m.TextTransformer),
});
