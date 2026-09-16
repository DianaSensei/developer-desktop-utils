import { Regex } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'regex',
  label: "Regex Tester",
  icon: Regex,
  description:
    "Test regular expressions with live match highlighting and group capture.",
  keywords: ["regex", "regexp", "regular expression", "match", "pattern", "test", "replace", "capture group"],
  route: '/regex',
  order: 130,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/RegexTester').then((m) => m.RegexTester),
});
