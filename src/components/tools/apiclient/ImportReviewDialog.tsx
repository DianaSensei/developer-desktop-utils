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
import { t } from './i18n';

const kindLabel = (kind: ScriptKind): string =>
  kind === 'pre-request' ? t('req.preRequest') : kind === 'post-response' ? t('req.postResponse') : t('review.tests');

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
      <DialogContent size="lg" scrollable>
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
            {t('review.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-2 border-b px-4 py-3 text-xs text-fg-mute">
          <p>
            <span className="font-medium text-fg">{collectionName}</span>{' '}
            {t(findings.length === 1 ? 'review.shipsOne' : 'review.ships', { n: findings.length })}
          </p>
          <p>
            {t('review.risk')}
          </p>
          <p>
            {t('review.brunoA')} <code className="rounded bg-bg-2 px-1 font-mono">bru.*</code> {t('review.brunoB')}{' '}
            <code className="rounded bg-bg-2 px-1 font-mono">dt.*</code> {t('review.brunoC')}{' '}
            <code className="rounded bg-bg-2 px-1 font-mono">bru</code> {t('review.brunoD')}{' '}
            <code className="rounded bg-bg-2 px-1 font-mono">pm.*</code> {t('review.brunoE')}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {findings.map((f, i) => {
            const open = expanded.has(i);
            return (
              <div key={i} className="border-b last:border-b-0">
                <button
                  onClick={() => toggle(i)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-acc/50"
                >
                  {open
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-mute" />}
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                  <span className="min-w-0 flex-1 truncate font-medium" title={f.path || collectionName}>
                    {f.path || collectionName}
                  </span>
                  <span className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-fg-mute">
                    {kindLabel(f.kind)}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-fg-mute">
                    {f.code.split('\n').length} lines
                  </span>
                </button>
                {open && (
                  <pre className="max-h-64 overflow-auto border-t bg-bg-2/30 px-4 py-2 font-mono text-[11px] leading-relaxed">
                    {f.code}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          <Button onClick={onImportWithoutScripts} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> {t('review.withoutScripts')}
          </Button>
          <Button variant="outline" onClick={onImportWithScripts}>
            {t('review.withScripts')}
          </Button>
          <Button variant="ghost" onClick={onCancel} className={cn('ml-auto text-fg-mute')}>
            {t('cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
