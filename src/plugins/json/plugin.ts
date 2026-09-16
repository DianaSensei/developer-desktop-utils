import { FileJson } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'json',
  label: "JSON Formatter",
  icon: FileJson,
  description:
    "Format, validate, minify, and explore JSON with syntax highlighting.",
  keywords: ["json", "format", "validate", "minify", "beautify", "prettify", "tree", "viewer", "parse"],
  route: '/json',
  order: 40,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/JsonFormatter').then((m) => m.JsonFormatter),
});
