import { Timer } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'task-tracker',
  label: "Time Tracker",
  icon: Timer,
  description:
    "Time tracker with timesheet, calendar, and meeting-notes views, projects, tags, and pomodoro.",
  keywords: ["time tracker", "timer", "timesheet", "pomodoro", "calendar", "clockify", "meeting notes", "project", "task", "stopwatch"],
  route: '/task-tracker',
  order: 10,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/clockify/Suite').then((m) => m.ClockifySuite),
});
