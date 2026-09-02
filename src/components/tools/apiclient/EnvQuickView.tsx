// A fast, read-only glance at every variable currently in scope — Collection
// env, Global env, Collection Variables, and Vault alike — sits next to the
// two environment pickers so seeing what's in effect (and where each value
// actually comes from) doesn't mean opening three separate dialogs and
// checking each one. Editing still only happens in each variable's own
// editor; this is look-don't-touch by design, with one link per editor at
// the bottom.

import { useState } from 'react';
import { Eye, EyeOff, Folder, Globe, KeyRound, Layers, Settings2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SectionLabel } from '@/components/ui/section-label';
import type { Environment, ResolvedVar, ResolvedVarSource } from './types';

interface Props {
  // The two environments actually applied right now — pass
  // `store.activeCollectionEnv`/`store.activeGlobalEnv`. Only used for the
  // header names and the reveal-secrets affordance; the variable list itself
  // comes from `resolvedVars`, not either env's own `.variables`.
  collectionEnv: Environment | null;
  globalEnv: Environment | null;
  // The merged, source-tagged variable set (collectionEnv/globalEnv/
  // collectionVar/vault) — see ApiClient.tsx's `resolvedVars`.
  resolvedVars: ResolvedVar[];
  onManageEnvironments: () => void;
  onManageVault: () => void;
}

const GROUP_ORDER: ResolvedVarSource[] = ['collectionEnv', 'globalEnv', 'collectionVar', 'vault'];
const GROUP_LABEL: Record<ResolvedVarSource, string> = {
  collectionEnv: 'Collection Environment', globalEnv: 'Global Environment',
  collectionVar: 'Collection Variables', vault: 'Vault',
};
const ENV_SOURCES = new Set<ResolvedVarSource>(['collectionEnv', 'globalEnv']);

export function EnvQuickView({ collectionEnv, globalEnv, resolvedVars, onManageEnvironments, onManageVault }: Props) {
  const [revealSecrets, setRevealSecrets] = useState(false);
  // Vault entries are always masked here regardless of the toggle (see
  // ApiClient.tsx's resolvedVars comment) — only a Collection/Global env
  // row's own `secret` flag is ever revealable from this view.
  const hasRevealable = resolvedVars.some((v) => ENV_SOURCES.has(v.source) && v.secret);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Quick view variables (Collection env, Global env, Collection Variables, Vault)"
        className="flex h-ctl w-ctl shrink-0 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-bg hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
      >
        <Eye className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 flex-col gap-1">
            {collectionEnv && (
              <div className="flex min-w-0 items-center gap-1.5">
                <Folder className="h-3 w-3 shrink-0 text-fg-mute" />
                <span className="truncate text-xs font-medium">{collectionEnv.name}</span>
              </div>
            )}
            {globalEnv && (
              <div className="flex min-w-0 items-center gap-1.5">
                <Globe className="h-3 w-3 shrink-0 text-fg-mute" />
                <span className="truncate text-xs font-medium">{globalEnv.name}</span>
              </div>
            )}
            {!collectionEnv && !globalEnv && (
              <div className="flex min-w-0 items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                <span className="truncate text-xs font-medium text-fg-mute">No Environment</span>
              </div>
            )}
          </div>
          {hasRevealable && (
            <button
              type="button"
              onClick={() => setRevealSecrets((v) => !v)}
              className="shrink-0 rounded p-1 text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              title={revealSecrets ? 'Hide secret environment values' : 'Reveal secret environment values'}
            >
              {revealSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {resolvedVars.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-fg-mute">
              No variables in scope for this request yet — set one in a Collection or Global
              environment, Collection Variables, the Vault, or with a script.
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
                            title={r.secret && !(ENV_SOURCES.has(source) && revealSecrets) ? 'Secret — masked here' : r.value}
                          >
                            {r.secret && !(ENV_SOURCES.has(source) && revealSecrets)
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
            Environments &amp; Collection Variables…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onManageVault} icon={<KeyRound className="h-3.5 w-3.5" />}>
            Vault…
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
