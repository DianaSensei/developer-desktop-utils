// Bottom status bar — app label left, quick actions right.
// Keeps chrome minimal; only includes actions the user can actually trigger.

import { AlertTriangle, Cookie, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { t } from './i18n';

export function StatusBar({ onSearch, onCookies, cookieCount, sandboxDegraded }: {
  onSearch: () => void;
  onCookies: () => void;
  cookieCount: number;
  sandboxDegraded?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t bg-bg-2/20 px-3 py-1 text-[11px] text-fg-mute">
      <div className="flex items-center gap-3">
        <span className="font-medium tracking-wide">API Client</span>
        {sandboxDegraded && (
          <span
            title={t('status.sandboxDown')}
            className="flex items-center gap-1"
          >
            <Badge tone="danger" variant="soft" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {t('status.scriptsPaused')}
            </Badge>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onSearch}
          title={t('status.focusSearch')}
          className="flex items-center gap-1 transition-colors hover:text-fg"
        >
          <Search className="h-3 w-3" /> {t('status.search')}
        </button>
        <span className="h-3 w-px bg-line" />
        <button
          onClick={onCookies}
          title={t('status.manageCookies')}
          className="flex items-center gap-1 transition-colors hover:text-fg"
        >
          <Cookie className="h-3 w-3" /> {t('status.cookies')}
          {cookieCount > 0 && (
            <Badge tone="warning" pill className="ml-0.5">{cookieCount}</Badge>
          )}
        </button>
      </div>
    </div>
  );
}
