import { useState } from 'react';
import { Trash2, ChevronDown } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatBytes } from './format';
import type { PruneResult } from './types';

/**
 * The "reclaim disk" control shared by the four resource views. Each view's
 * prune differs only in wording and in which endpoint runs, so the confirm
 * step, the busy state and the "removed N, reclaimed X" reporting live here
 * once. A single variant renders one button; several (images: dangling vs.
 * every unused image) render a menu, since the two differ enough in
 * destructiveness that they must not share one click target.
 */
export interface PruneVariant {
  label: string;
  /** Shown in the confirm dialog — say exactly what will be deleted. */
  description: string;
  run: () => Promise<PruneResult>;
  danger?: boolean;
}

/** "Removed 4 · reclaimed 1.2 GB" / "Nothing to remove" */
export function describePruneResult(result: PruneResult, noun: string): string {
  if (result.deleted === 0 && result.spaceReclaimed === 0) return `No unused ${noun} to remove.`;
  const space = result.spaceReclaimed > 0 ? ` · reclaimed ${formatBytes(result.spaceReclaimed)}` : '';
  return `Removed ${result.deleted.toLocaleString()} ${noun}${space}.`;
}

export function PruneButton({ variants, noun, onDone, onError }: {
  variants: PruneVariant[];
  /** Plural noun for the result line: "images", "volumes", … */
  noun: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<PruneVariant | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      onDone(describePruneResult(await pending.run(), noun));
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <>
      {variants.length === 1 ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending(variants[0])}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {variants[0].label}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            title="Reclaim disk space"
            disabled={busy}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
          >
            <Trash2 className="h-3.5 w-3.5" /> Prune <ChevronDown className="h-3 w-3 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {variants.map((v) => (
              <DropdownMenuItem key={v.label} className={v.danger ? 'text-bad' : undefined} onClick={() => setPending(v)}>
                {v.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => { if (!o && !busy) setPending(null); }}
        title={pending?.label ?? ''}
        description={pending?.description ?? ''}
        confirmLabel="Prune"
        onConfirm={confirm}
      />
    </>
  );
}
