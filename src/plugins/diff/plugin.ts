import { GitCompare } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'diff',
  label: "Diff",
  icon: GitCompare,
  description:
    "Compare two text blocks (word-level) or two JSON values (structural, by path).",
  keywords: ["diff", "compare", "difference", "text", "json", "changes", "merge"],
  route: '/diff',
  order: 140,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/diff/TextDiff').then((m) => m.TextDiff),
});
