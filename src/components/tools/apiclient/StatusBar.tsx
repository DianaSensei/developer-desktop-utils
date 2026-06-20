// Bruno-style bottom status bar: app label on the left, quick actions + version
// on the right. "Search" focuses the collections filter; the rest are passive
// status affordances.

import { Cookie, Search, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

const VERSION = 'v0.1.0';

export function StatusBar({ onSearch, onCookies, cookieCount }: {
  onSearch: () => void;
  onCookies: () => void;
  cookieCount: number;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t px-3 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium">API Client</span>
      <div className="flex items-center gap-4">
        <button onClick={onSearch} className="flex items-center gap-1 transition-colors hover:text-foreground">
          <Search className="h-3.5 w-3.5" /> Search
        </button>
        <button onClick={onCookies} className="flex items-center gap-1 transition-colors hover:text-foreground" title="Manage cookies">
          <Cookie className="h-3.5 w-3.5" /> Cookies
          {cookieCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold text-foreground">{cookieCount}</span>
          )}
        </button>
        <span className={cn('flex items-center gap-1 opacity-50')} title="Not available yet">
          <Wrench className="h-3.5 w-3.5" /> Dev Tools
        </span>
        <span>{VERSION}</span>
      </div>
    </div>
  );
}
