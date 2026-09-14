import { Dices } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'generator',
  label: "Generator",
  icon: Dices,
  description:
    "Generate UUIDs, random numbers and text, or realistic fake datasets (names, emails, dates…) exported as JSON, CSV, SQL, and more.",
  keywords: ["uuid", "guid", "random", "fake data", "mock data", "faker", "test data", "lorem ipsum", "number", "string", "csv", "sql", "seed"],
  route: '/generator',
  order: 100,
  defaultEnabled: true,
  permissions: ['storage', 'files:write', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/Generator').then((m) => m.Generator),
});
