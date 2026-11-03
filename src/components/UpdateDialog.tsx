import { Download, Sparkles, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useUpdate } from '@/contexts/UpdateContext';

/**
 * Shown when an update check (on launch / daily at 6am, or "Check now")
 * finds a new version. A card in the bottom-left corner, not a modal: it
 * doesn't take the keyboard or block the tool you're working in, and stays
 * until you install or choose Later.
 */
export function UpdateDialog() {
  const { showUpdateDialog, dismissUpdateDialog, updateInfo, status, downloadProgress, installUpdate, cancelInstall } = useUpdate();
  const isDownloading = status === 'downloading';
  if (!showUpdateDialog) return null;

  return (
    <section
      aria-label="Update available"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-card p-3 shadow-lift"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok/10 text-ok">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Update available</p>
          <p className="text-xs text-fg-mute">
            Version <span className="font-mono font-medium text-fg">{updateInfo?.version}</span> is ready to install.
          </p>
        </div>
        {!isDownloading && (
          <button
            type="button"
            onClick={dismissUpdateDialog}
            aria-label="Later"
            title="Later"
            className="rounded-xs p-0.5 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {updateInfo?.body && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-fg-mute hover:text-fg">What's new</summary>
          <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-bg-2/40 p-2 text-fg-mute">
            {updateInfo.body}
          </div>
        </details>
      )}

      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        {isDownloading ? (
          <Button variant="ghost" size="sm" className="text-xs" onClick={cancelInstall}>Cancel</Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-xs" onClick={dismissUpdateDialog}>Later</Button>
        )}
        <Button size="sm" className="gap-1.5 text-xs" onClick={installUpdate} disabled={isDownloading}>
          {isDownloading ? (
            <>
              <Spinner size="sm" />
              {downloadProgress != null ? `Installing… ${downloadProgress}%` : 'Installing…'}
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              Install &amp; restart
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
