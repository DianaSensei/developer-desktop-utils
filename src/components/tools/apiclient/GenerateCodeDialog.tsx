// "Generate Code" modal (Bruno-style): pick a language + variant, optionally
// interpolate {{vars}}, preview the snippet, and copy it.

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeViewer } from '@/design-system';
import { CODE_TARGETS, generateCode } from './codegen';
import type { ApiRequest, KeyValue, VarMap } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  request: ApiRequest | null;
  vars: VarMap;
  // Collection/folder headers that apply ahead of the request's own (see
  // request.ts's buildHeaders) — included so the generated snippet matches
  // what Send actually transmits.
  inheritedHeaders?: KeyValue[][];
}

export function GenerateCodeDialog({ open, onClose, request, vars, inheritedHeaders = [] }: Props) {
  const [lang, setLang] = useState('Shell');
  const [variant, setVariant] = useState('curl');
  const [interpolate, setInterpolate] = useState(true);

  const target = CODE_TARGETS.find((t) => t.lang === lang) ?? CODE_TARGETS[0];

  const code = useMemo(
    () => (request ? generateCode(request, vars, lang, variant, interpolate, inheritedHeaders) : ''),
    [request, vars, lang, variant, interpolate, inheritedHeaders],
  );

  const pickLang = (l: string) => {
    setLang(l);
    const next = CODE_TARGETS.find((t) => t.lang === l);
    if (next && !next.variants.some((v) => v.id === variant)) setVariant(next.variants[0].id);
  };


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="2xl" scrollable>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-base">Generate Code</DialogTitle>
        </div>

        {/* toolbar */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Select value={lang} onValueChange={pickLang}>
            <SelectTrigger className="h-ctl w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CODE_TARGETS.map((t) => <SelectItem key={t.lang} value={t.lang}>{t.lang}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            {target.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariant(v.id)}
                className={cn(
                  'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                  variant === v.id ? 'border-acc/30 bg-acc/10 text-acc' : 'hover:bg-acc',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
            <button
              type="button"
              role="checkbox"
              aria-checked={interpolate}
              onClick={() => setInterpolate((i) => !i)}
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                interpolate ? 'border-acc bg-acc text-acc-fg' : 'border-sunk',
              )}
            >
              {interpolate && <Check className="h-3 w-3" />}
            </button>
            Interpolate Variables
          </label>
        </div>

        {/* code preview */}
        <div className="relative flex min-h-0 flex-1 flex-col border-t">
          <CodeViewer value={code} language="text" />
          <CopyButton
            value={() => code}
            title="Copy"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 h-ctl w-ctl text-fg-mute"
            iconClassName="h-4 w-4"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
