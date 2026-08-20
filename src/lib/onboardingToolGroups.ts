import { Send, FileJson, CaseSensitive, CalendarClock, Pipette, ShieldCheck, Disc3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Coarse groupings over TOOL_DEFS, used only by the onboarding tool-picker step
// to let a new user select by area of interest instead of scanning 24 tools
// one by one. Not a general "category" concept — TOOL_DEFS itself stays flat.
export interface OnboardingToolGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  toolIds: string[];
}

export const ONBOARDING_TOOL_GROUPS: OnboardingToolGroup[] = [
  {
    id: 'api-messaging',
    label: 'API & Messaging',
    icon: Send,
    toolIds: ['api-client', 'mock-server', 'kafka-explorer', 'rabbit-client', 'redis-client'],
  },
  {
    id: 'data-format',
    label: 'Data & Formatters',
    icon: FileJson,
    toolIds: ['json', 'data-converter', 'sql-formatter', 'diff', 'deduplicate'],
  },
  {
    id: 'text-encoding',
    label: 'Text & Encoding',
    icon: CaseSensitive,
    toolIds: ['text-transform', 'text-counter', 'base64', 'regex', 'markdown'],
  },
  {
    id: 'time-productivity',
    label: 'Time & Productivity',
    icon: CalendarClock,
    toolIds: ['task-tracker', 'cron-generator', 'unix-time', 'generator'],
  },
  {
    id: 'design-media',
    label: 'Design & Media',
    icon: Pipette,
    toolIds: ['color-picker', 'qrcode'],
  },
  {
    id: 'network-security',
    label: 'Network & Security',
    icon: ShieldCheck,
    toolIds: ['network', 'jwt', '2fa'],
  },
  {
    id: 'fun',
    label: 'Fun',
    icon: Disc3,
    toolIds: ['lucky-wheel'],
  },
];
