// Bottom status bar — app label left, quick actions right.
// Keeps chrome minimal; only includes actions the user can actually trigger.

import { AlertTriangle, Cookie, Search, Variable } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function StatusBar({ onSearch, onCookies, cookieCount, onRuntimeVars, runtimeVarCount, sandboxDegraded }: {
  onSearch: () => void;
  onCookies: () => void;
  cookieCount: number;
  onRuntimeVars: () => void;
  runtimeVarCount: number;
  sandboxDegraded?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t bg-bg-2/20 px-3 py-1 text-[11px] text-fg-mute">
      <div className="flex items-center gap-3">
        <span className="font-medium tracking-wide">API Client</span>
        {sandboxDegraded && (
          <span
            title="The script sandbox worker failed to load — scripts are running unsandboxed on the main thread with no timeout, so an infinite loop will freeze the app. Retrying periodically."
            className="flex items-center gap-1"
          >
            <Badge tone="danger" variant="soft" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Script sandbox degraded
            </Badge>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onSearch}
          title="Focus collection search (⌘F)"
          className="flex items-center gap-1 transition-colors hover:text-fg"
        >
          <Search className="h-3 w-3" /> Search
        </button>
        <span className="h-3 w-px bg-line" />
        <button
          onClick={onRuntimeVars}
          title="Inspect runtime variables (bru.setVar)"
          className="flex items-center gap-1 transition-colors hover:text-fg"
        >
          <Variable className="h-3 w-3" /> Vars
          {runtimeVarCount > 0 && (
            <Badge tone="neutral" pill className="ml-0.5">{runtimeVarCount}</Badge>
          )}
        </button>
        <span className="h-3 w-px bg-line" />
        <button
          onClick={onCookies}
          title="Manage cookies"
          className="flex items-center gap-1 transition-colors hover:text-fg"
        >
          <Cookie className="h-3 w-3" /> Cookies
          {cookieCount > 0 && (
            <Badge tone="warning" pill className="ml-0.5">{cookieCount}</Badge>
          )}
        </button>
      </div>
    </div>
  );
}
