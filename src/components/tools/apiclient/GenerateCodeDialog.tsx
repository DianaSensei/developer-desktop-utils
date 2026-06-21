// "Generate Code" modal (Bruno-style): pick a language + variant, optionally
// interpolate {{vars}}, preview the snippet, and copy it.

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResponseViewer } from './ResponseViewer';
import { CODE_TARGETS, generateCode } from './codegen';
import type { ApiRequest, VarMap } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  request: ApiRequest | null;
  vars: VarMap;
}

export function GenerateCodeDialog({ open, onClose, request, vars }: Props) {
  const [lang, setLang] = useState('Shell');
  const [variant, setVariant] = useState('curl');
  const [interpolate, setInterpolate] = useState(true);
  const [copied, setCopied] = useState(false);

  const target = CODE_TARGETS.find((t) => t.lang === lang) ?? CODE_TARGETS[0];

  const code = useMemo(
    () => (request ? generateCode(request, vars, lang, variant, interpolate) : ''),
    [request, vars, lang, variant, interpolate],
  );

  const pickLang = (l: string) => {
    setLang(l);
    const next = CODE_TARGETS.find((t) => t.lang === l);
    if (next && !next.variants.some((v) => v.id === variant)) setVariant(next.variants[0].id);
  };

  const copy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-base">Generate Code</DialogTitle>
        </div>

        {/* toolbar */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Select value={lang} onValueChange={pickLang}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
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
                  variant === v.id ? 'border-transparent bg-blue-500 text-white' : 'hover:bg-accent',
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
                interpolate ? 'border-amber-400 bg-amber-400 text-neutral-900' : 'border-input',
              )}
            >
              {interpolate && <Check className="h-3 w-3" />}
            </button>
            Interpolate Variables
          </label>
        </div>

        {/* code preview */}
        <div className="relative min-h-0 flex-1 border-t">
          <ResponseViewer value={code} language="text" />
          <button
            onClick={copy}
            title="Copy"
            className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
