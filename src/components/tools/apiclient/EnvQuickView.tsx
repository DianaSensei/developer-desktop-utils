// A fast, read-only glance at every variable currently in scope — env,
// collection, session runtime, and Vault alike — sits next to the environment
// picker so seeing what's in effect (and where each value actually comes
// from) doesn't mean opening three separate dialogs and checking each one.
// Editing still only happens in each variable's own editor; this is
// look-don't-touch by design, with one link per editor at the bottom.

import { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Layers, Settings2, Variable } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SectionLabel } from '@/components/ui/section-label';
import type { Environment, ResolvedVar, ResolvedVarSource } from './types';

interface Props {
  // The environment actually applied right now (already resolved for scope
  // mismatch — pass `store.activeEnv`, not `store.selectedEnv`). Only used
  // for the header name and the reveal-secrets affordance; the variable list
  // itself comes from `resolvedVars`, not `env.variables`.
  env: Environment | null;
  // A collection-scoped environment that's selected but inactive here, if any
  // (`store.activeEnvMismatched ? store.selectedEnv : null`) — surfaced so the
  // quick view explains an empty variable list instead of looking broken.
  mismatched: Environment | null;
  // The merged, source-tagged variable set (collection/env/vault/runtime) —
  // see ApiClient.tsx's `resolvedVars`.
  resolvedVars: ResolvedVar[];
  onManageEnvironments: () => void;
  onManageVault: () => void;
  onRuntimeVars: () => void;
}

const GROUP_ORDER: ResolvedVarSource[] = ['env', 'collection', 'runtime', 'vault'];
const GROUP_LABEL: Record<ResolvedVarSource, string> = {
  env: 'Environment', collection: 'Collection', runtime: 'Runtime', vault: 'Vault',
};

export function EnvQuickView({ env, mismatched, resolvedVars, onManageEnvironments, onManageVault, onRuntimeVars }: Props) {
  const [revealSecrets, setRevealSecrets] = useState(false);
  // Vault entries are always masked here regardless of the toggle (see
  // ApiClient.tsx's resolvedVars comment) — only an env row's own `secret`
  // flag is ever revealable from this view.
  const hasRevealable = resolvedVars.some((v) => v.source === 'env' && v.secret);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Quick view variables (environment, collection, runtime, Vault)"
        className="flex h-ctl w-ctl shrink-0 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-bg hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
      >
        <Eye className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
            <span className="truncate text-xs font-medium">{env ? env.name : 'No Environment'}</span>
          </div>
          {hasRevealable && (
            <button
              type="button"
              onClick={() => setRevealSecrets((v) => !v)}
              className="shrink-0 rounded p-1 text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
              title={revealSecrets ? 'Hide secret environment values' : 'Reveal secret environment values'}
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

        <div className="max-h-80 overflow-y-auto p-1">
          {resolvedVars.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-fg-mute">
              No variables in scope for this request yet — set one in the Environment, Collection,
              Vault, or with a script.
            </p>
          ) : (
            <div className="space-y-2">
              {GROUP_ORDER.map((source) => {
                const rows = resolvedVars.filter((v) => v.source === source);
                if (rows.length === 0) return null;
                return (
                  <div key={source}>
                    <SectionLabel className="px-2 py-1" count={rows.length}>{GROUP_LABEL[source]}</SectionLabel>
                    <div className="divide-y divide-line/60">
                      {rows.map((r) => (
                        <div key={r.name} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                          <span className="w-2/5 shrink-0 truncate font-medium" title={r.name}>{r.name}</span>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-fg-mute"
                            title={r.secret && !(source === 'env' && revealSecrets) ? 'Secret — masked here' : r.value}
                          >
                            {r.secret && !(source === 'env' && revealSecrets)
                              ? '••••••••'
                              : r.value || <span className="italic text-fg-mute/50">empty</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem onClick={onManageEnvironments} icon={<Settings2 className="h-3.5 w-3.5" />}>
            Environment &amp; Collection Variables…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onManageVault} icon={<KeyRound className="h-3.5 w-3.5" />}>
            Vault…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRuntimeVars} icon={<Variable className="h-3.5 w-3.5" />}>
            Runtime Variables…
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
