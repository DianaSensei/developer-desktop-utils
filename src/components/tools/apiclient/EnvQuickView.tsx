// A fast, read-only glance at the environment currently in effect — sits next
// to the "Configure environments" gear so seeing what's active doesn't require
// opening the full Environments dialog and clicking into it. Editing still
// only happens there; this is look-don't-touch by design.

import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Layers } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { Environment } from './types';

interface Props {
  // The environment actually applied right now (already resolved for scope
  // mismatch — pass `store.activeEnv`, not `store.selectedEnv`).
  env: Environment | null;
  // A collection-scoped environment that's selected but inactive here, if any
  // (`store.activeEnvMismatched ? store.selectedEnv : null`) — surfaced so the
  // quick view explains an empty variable list instead of looking broken.
  mismatched: Environment | null;
  onManage: () => void;
}

export function EnvQuickView({ env, mismatched, onManage }: Props) {
  const [revealSecrets, setRevealSecrets] = useState(false);
  const rows = (env?.variables ?? []).filter((v) => v.enabled && v.key.trim() !== '');
  const hasSecrets = rows.some((r) => r.secret);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Quick view environment"
        className="flex h-ctl w-ctl shrink-0 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-bg hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
      >
        <Eye className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
            <span className="truncate text-xs font-medium">{env ? env.name : 'No Environment'}</span>
          </div>
          {hasSecrets && (
            <button
              type="button"
              onClick={() => setRevealSecrets((v) => !v)}
              className="shrink-0 rounded p-1 text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
              title={revealSecrets ? 'Hide secret values' : 'Reveal secret values'}
            >
              {revealSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {mismatched && !env && (
          <div className="flex items-start gap-2 border-b bg-warn-tint px-3 py-2 text-[11px] text-warn">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>&ldquo;{mismatched.name}&rdquo; belongs to another collection and isn&rsquo;t applied here.</span>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto p-1">
          {!env ? (
            <p className="px-2 py-4 text-center text-[11px] text-fg-mute">
              Pick an environment from the dropdown to see its variables here.
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-fg-mute">
              This environment has no variables yet.
            </p>
          ) : (
            <div className="divide-y divide-line/60">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                  <span className="w-2/5 shrink-0 truncate font-medium" title={r.key}>{r.key}</span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-fg-mute"
                    title={r.secret && !revealSecrets ? 'Secret — click the eye above to reveal' : r.value}
                  >
                    {r.secret && !revealSecrets
                      ? '••••••••'
                      : r.value || <span className="italic text-fg-mute/50">empty</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem onClick={onManage} className="font-medium text-acc-ink">
            Manage environments…
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
