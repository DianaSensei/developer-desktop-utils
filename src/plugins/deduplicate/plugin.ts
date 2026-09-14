import { CopyMinus } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'deduplicate',
  label: "Deduplicate",
  icon: CopyMinus,
  description:
    "Remove duplicate lines or items from any list.",
  keywords: ["deduplicate", "dedup", "unique", "remove duplicates", "distinct", "lines", "list"],
  route: '/deduplicate',
  order: 60,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/ArrayDeduplicator').then((m) => m.ArrayDeduplicator),
});
