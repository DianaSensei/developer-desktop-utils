import { Download, Loader2, Sparkles } from 'lucide-react';
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
  const { showUpdateDialog, dismissUpdateDialog, updateInfo, status, installUpdate } = useUpdate();
  const isDownloading = status === 'downloading';

  return (
    <Dialog open={showUpdateDialog} onOpenChange={(open) => { if (!open) dismissUpdateDialog(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Update available
          </DialogTitle>
          <DialogDescription>
            Version <span className="font-mono font-medium text-foreground">{updateInfo?.version}</span> is ready to install.
          </DialogDescription>
        </DialogHeader>

        {updateInfo?.body && (
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {updateInfo.body}
          </div>
        )}

        <DialogFooter>
          <button
            onClick={dismissUpdateDialog}
            disabled={isDownloading}
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Later
          </button>
          <button
            onClick={installUpdate}
            disabled={isDownloading}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Installing…
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
