import { useEffect, useState } from 'react';
import { Play, Square, RotateCw, Pause, PlayCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { containerApi, type ContainerConnection, type ContainerSummary } from './types';
import { LogsPanel } from './LogsPanel';

function stateTone(state?: string): BadgeTone {
  switch (state) {
    case 'running': return 'success';
    case 'paused': return 'warning';
    case 'exited':
    case 'dead': return 'danger';
    default: return 'neutral';
  }
}

function containerName(c: ContainerSummary): string {
  return c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
}

/**
 * The log window, shared by the containers list and the compose view — both
 * had their own copy of this dialog, which is how compose ended up without the
 * lifecycle buttons the containers list had.
 *
 * Sized deliberately larger than the app's other dialogs: log reading is the
 * one task here where more visible lines is the whole point, and the previous
 * `max-w-3xl` × `50vh` showed about twenty of them.
 */
export function ContainerLogsDialog({ open, onOpenChange, connection, container, onAction, onRemove }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  container: ContainerSummary | null;
  /** Runs a lifecycle action and refreshes the owning list. */
  onAction: (id: string, action: () => Promise<void>) => void | Promise<void>;
  /** Opens the owning view's remove confirmation. Omit to hide the button. */
  onRemove?: (container: ContainerSummary) => void;
}) {
  // Kept one render behind `container` so the Dialog can stay mounted and play
  // its exit animation instead of the subtree vanishing the instant the target
  // clears — the same trick the details dialog uses.
  const [shown, setShown] = useState<ContainerSummary | null>(container);
  useEffect(() => { if (container) setShown(container); }, [container]);

  const target = shown;
  const running = target?.State === 'running';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <span className="font-mono">{containerName(target)}</span>
                <Badge tone={stateTone(target.State)}>{target.State ?? 'unknown'}</Badge>
                <span className="truncate text-[11px] font-normal text-fg-mute">{target.Image}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-end gap-1">
                {running ? (
                  <Button variant="outline" size="sm" onClick={() => onAction(target.Id, () => containerApi.stop(connection, target.Id))}>
                    <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => onAction(target.Id, () => containerApi.start(connection, target.Id))}>
                    <Play className="h-3.5 w-3.5 mr-1.5" /> Start
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onAction(target.Id, () => containerApi.restart(connection, target.Id))}>
                  <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Restart
                </Button>
                {running ? (
                  <Button variant="outline" size="sm" onClick={() => onAction(target.Id, () => containerApi.pause(connection, target.Id))}>
                    <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                  </Button>
                ) : target.State === 'paused' ? (
                  <Button variant="outline" size="sm" onClick={() => onAction(target.Id, () => containerApi.unpause(connection, target.Id))}>
                    <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Unpause
                  </Button>
                ) : null}
                {onRemove && (
                  <Button variant="outline" size="sm" className="hover:text-bad" onClick={() => onRemove(target)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
                  </Button>
                )}
              </div>
              {/* Tall by design, but never taller than the window minus the
                  dialog's own chrome — otherwise the toolbar scrolls off on a
                  short laptop screen. */}
              <div className="flex h-[68vh] max-h-[calc(100vh-13rem)] flex-col">
                <LogsPanel
                  key={target.Id}
                  name={containerName(target)}
                  start={(tail, since, until, timestamps, onLog) =>
                    containerApi.logsStart(connection, target.Id, tail, since, until, timestamps, onLog)}
                  stop={containerApi.logsStop}
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
