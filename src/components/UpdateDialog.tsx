import { Download, Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useUpdate } from '@/contexts/UpdateContext';

/**
 * Popup shown when an automatic update check (on launch / daily at 6am) finds a new version.
 */
export function UpdateDialog() {
  const { showUpdateDialog, dismissUpdateDialog, updateInfo, status, downloadProgress, installUpdate, cancelInstall } = useUpdate();
  const isDownloading = status === 'downloading';

  return (
    <Dialog open={showUpdateDialog} onOpenChange={(open) => { if (!open) dismissUpdateDialog(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ok" />
            Update available
          </DialogTitle>
          <DialogDescription>
            Version <span className="font-mono font-medium text-fg">{updateInfo?.version}</span> is ready to install.
          </DialogDescription>
        </DialogHeader>

        {updateInfo?.body && (
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-fg-mute">
            {updateInfo.body}
          </div>
        )}

        <DialogFooter>
          {isDownloading ? (
            <button
              onClick={cancelInstall}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-fg-mute transition-colors hover:bg-muted hover:text-fg"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={dismissUpdateDialog}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-fg-mute transition-colors hover:bg-muted hover:text-fg"
            >
              Later
            </button>
          )}
          <button
            onClick={installUpdate}
            disabled={isDownloading}
            className="flex items-center gap-1.5 rounded-md bg-acc px-3 py-1.5 text-xs font-medium text-acc-fg transition-colors hover:bg-acc/90 disabled:opacity-50"
          >
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
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
