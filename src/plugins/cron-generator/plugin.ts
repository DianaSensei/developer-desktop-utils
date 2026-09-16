import { CalendarClock } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'cron-generator',
  label: "Cron Generator",
  icon: CalendarClock,
  description:
    "Build and validate cron expressions with a visual editor.",
  keywords: ["crontab", "schedule", "quartz", "spring", "job", "timer", "expression"],
  route: '/',
  order: 150,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/CronGenerator').then((m) => m.CronGenerator),
});
