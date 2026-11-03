import { Timer } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'task-tracker',
  label: "Time Tracker",
  icon: Timer,
  description:
    "Time tracker and to-do list with reminders and Jira sync, timesheet, calendar, and meeting-notes views, projects, tags, and pomodoro.",
  keywords: ["time tracker", "timer", "timesheet", "pomodoro", "calendar", "clockify", "meeting notes", "project", "task", "stopwatch", "todo", "to-do", "reminder", "deadline", "jira", "worklog", "issue"],
  route: '/task-tracker',
  order: 10,
  defaultEnabled: true,
  permissions: ['storage', 'secrets', 'http', 'files:write', 'clipboard:read', 'clipboard:write', 'open-url', 'notifications'],
  // Jira Cloud only (Tasks tab → Connect Jira); the API token is in `secrets`.
  hosts: ['*.atlassian.net'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/clockify/Suite').then((m) => m.ClockifySuite),
});
