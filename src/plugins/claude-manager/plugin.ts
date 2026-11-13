import { Bot } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'claude-manager',
  label: 'Claude Manager',
  icon: Bot,
  description:
    'Monitor Claude Code on this machine: running and past sessions, their status, subagents, token usage and estimated cost — across several accounts.',
  keywords: ['claude', 'claude code', 'anthropic', 'agent', 'agents', 'session', 'sessions', 'usage', 'tokens', 'cost', 'multi account', 'accounts', 'orca', 'ccusage', 'ai', 'llm'],
  route: '/claude-manager',
  order: 270,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:write', 'native'],
  // Read-only: scans Claude Code's config directories for transcripts.
  commands: ['claude_monitor_scan', 'claude_monitor_detect'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/claude/ClaudeManager').then((m) => m.ClaudeManager),
});
