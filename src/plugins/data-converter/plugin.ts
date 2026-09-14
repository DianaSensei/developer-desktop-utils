import { ArrowLeftRight } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'data-converter',
  label: "Data Converter",
  icon: ArrowLeftRight,
  description:
    "Convert structured data between JSON, YAML, TOML, XML, and .properties — fully offline.",
  keywords: ["json", "yaml", "yml", "toml", "xml", "properties", "convert", "transform"],
  route: '/data-converter',
  order: 50,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/DataConverter').then((m) => m.DataConverter),
});
