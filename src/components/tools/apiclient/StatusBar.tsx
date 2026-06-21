// Bottom status bar — app label left, quick actions right.
// Keeps chrome minimal; only includes actions the user can actually trigger.

import { Cookie, Search } from 'lucide-react';

export function StatusBar({ onSearch, onCookies, cookieCount }: {
  onSearch: () => void;
  onCookies: () => void;
  cookieCount: number;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium tracking-wide">API Client</span>
      <div className="flex items-center gap-3">
        <button
          onClick={onSearch}
          title="Focus collection search (⌘F)"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Search className="h-3 w-3" /> Search
        </button>
        <span className="h-3 w-px bg-border" />
        <button
          onClick={onCookies}
          title="Manage cookies"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Cookie className="h-3 w-3" /> Cookies
          {cookieCount > 0 && (
            <span className="ml-0.5 rounded-full bg-amber-400/20 px-1.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
              {cookieCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
