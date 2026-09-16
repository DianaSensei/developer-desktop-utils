import { Database } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'sql-formatter',
  label: "SQL Formatter",
  icon: Database,
  description:
    "Format and beautify SQL queries — or MongoDB shell/aggregation queries — with keyword casing, space collapse, and clause line breaks.",
  keywords: ["sql", "mysql", "postgres", "query", "format", "beautify", "prettify", "mongodb", "mongo", "aggregation"],
  route: '/sql-formatter',
  order: 80,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/SqlFormatter').then((m) => m.SqlFormatter),
});
