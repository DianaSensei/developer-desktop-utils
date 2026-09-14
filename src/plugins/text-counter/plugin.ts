import { Type } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'text-counter',
  label: "Text Counter",
  icon: Type,
  description:
    "Count characters, words, lines and estimate reading time.",
  keywords: ["characters", "words", "lines", "length", "count", "reading time", "bytes", "letters"],
  route: '/text-counter',
  order: 120,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/TextCounter').then((m) => m.TextCounter),
});
