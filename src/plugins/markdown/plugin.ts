import { FileText } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'markdown',
  label: "Markdown",
  icon: FileText,
  description:
    "Live Markdown preview with standard formatting support.",
  keywords: ["markdown", "md", "preview", "readme", "render", "gfm"],
  route: '/markdown',
  order: 230,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/MarkdownPreview').then((m) => m.MarkdownPreview),
});
