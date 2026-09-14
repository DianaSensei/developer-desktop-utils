import { Clock } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'unix-time',
  label: "Date / Time",
  icon: Clock,
  description:
    "Convert timestamps, compare dates, and format in any timezone.",
  keywords: ["timestamp", "epoch", "unix time", "date", "time", "timezone", "iso 8601", "utc", "convert", "duration"],
  route: '/unix-time',
  order: 90,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/DateTimeTool').then((m) => m.DateTimeTool),
});
