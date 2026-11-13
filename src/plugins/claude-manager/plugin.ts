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
  permissions: ['storage', 'clipboard:write', 'files:read', 'native'],
  // Read-only: finds Claude Code's config directories and reads their
  // transcripts. `files:read` is for the folder picker only.
  commands: ['claude_monitor_scan', 'claude_monitor_detect'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/claude/ClaudeManager').then((m) => m.ClaudeManager),
});
