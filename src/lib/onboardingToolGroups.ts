import { Send, FileJson, CaseSensitive, CalendarClock, Pipette, ShieldCheck, Disc3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

// Coarse groupings over TOOL_DEFS, used only by the onboarding tool-picker step
// to let a new user select by area of interest instead of scanning 24 tools
// one by one. Not a general "category" concept — TOOL_DEFS itself stays flat.
export interface OnboardingToolGroup {
  id: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  toolIds: string[];
}

export const ONBOARDING_TOOL_GROUPS: OnboardingToolGroup[] = [
  {
    id: 'api-messaging',
    labelKey: 'onboarding.group.api-messaging',
    icon: Send,
    toolIds: ['api-client', 'mock-server'],
  },
  {
    id: 'data-format',
    labelKey: 'onboarding.group.data-format',
    icon: FileJson,
    toolIds: ['json', 'data-converter', 'sql-formatter', 'diff', 'deduplicate'],
  },
  {
    id: 'text-encoding',
    labelKey: 'onboarding.group.text-encoding',
    icon: CaseSensitive,
    toolIds: ['text-transform', 'text-counter', 'base64', 'regex', 'markdown'],
  },
  {
    id: 'time-productivity',
    labelKey: 'onboarding.group.time-productivity',
    icon: CalendarClock,
    toolIds: ['task-tracker', 'cron-generator', 'unix-time', 'generator'],
  },
  {
    id: 'design-media',
    labelKey: 'onboarding.group.design-media',
    icon: Pipette,
    toolIds: ['color-picker', 'qrcode'],
  },
  {
    id: 'network-security',
    labelKey: 'onboarding.group.network-security',
    icon: ShieldCheck,
    toolIds: ['network', '2fa'],
  },
  {
    id: 'fun',
    labelKey: 'onboarding.group.fun',
    icon: Disc3,
    toolIds: ['lucky-wheel'],
  },
];
