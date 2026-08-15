// Consent step for importing a collection that carries executable scripts.
//
// Postman collections can embed pre-request and test scripts. They run as soon
// as the user sends one of the collection's requests, with access to the
// environment (including secrets kept there) and to the network — so importing
// a collection from a colleague, a gist, or an API vendor is a decision to run
// their code. This dialog makes that decision explicit and defaults to the safe
// answer: take the requests, leave the scripts.

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileCode2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ScriptFinding, ScriptKind } from './collectionScripts';

const KIND_LABEL: Record<ScriptKind, string> = {
  'pre-request': 'Pre-request',
  'post-response': 'Post-response',
  tests: 'Tests',
};

interface Props {
  open: boolean;
  collectionName: string;
  findings: ScriptFinding[];
  onImportWithScripts: () => void;
  onImportWithoutScripts: () => void;
  onCancel: () => void;
}

export function ImportReviewDialog({
  open, collectionName, findings, onImportWithScripts, onImportWithoutScripts, onCancel,
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
            This collection contains scripts
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-2 border-b px-4 py-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{collectionName}</span> ships{' '}
            {findings.length} script{findings.length === 1 ? '' : 's'} that would run automatically
            whenever you send one of its requests.
          </p>
          <p>
            Scripts can read your environment variables — including any tokens stored there — and
            can make their own network calls. Only keep them if you trust where this file came from.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {findings.map((f, i) => {
            const open = expanded.has(i);
            return (
              <div key={i} className="border-b last:border-b-0">
                <button
                  onClick={() => toggle(i)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-accent/50"
                >
                  {open
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium" title={f.path || collectionName}>
                    {f.path || collectionName}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {KIND_LABEL[f.kind]}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                    {f.code.split('\n').length} lines
                  </span>
                </button>
                {open && (
                  <pre className="max-h-64 overflow-auto border-t bg-muted/30 px-4 py-2 font-mono text-[11px] leading-relaxed">
                    {f.code}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          <Button onClick={onImportWithoutScripts} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Import without scripts
          </Button>
          <Button variant="outline" onClick={onImportWithScripts}>
            Import with scripts
          </Button>
          <Button variant="ghost" onClick={onCancel} className={cn('ml-auto text-muted-foreground')}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
