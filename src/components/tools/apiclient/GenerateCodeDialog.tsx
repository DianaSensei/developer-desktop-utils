// "Generate Code" modal (Bruno-style): pick a language + variant, optionally
// interpolate {{vars}}, preview the snippet, and copy it.

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

          {/* Segmented, not three hand-rolled pill buttons: this is the kit's
              mode-switch control, and the hand-rolled version's "selected"
              state (a 10%-accent tint) was far weaker than every other
              selected state in the tool. */}
          <Segmented
            value={variant}
            onValueChange={setVariant}
            size="sm"
            aria-label="Variant"
            options={target.variants.map((v) => ({ value: v.id, label: v.label }))}
          />

          {/* Switch, not a hand-rolled role="checkbox" button — the app has no
              checkbox primitive, and every other on/off in the tool (Settings
              tab, Runner, cookie jar) is a Switch. */}
          <Label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
            Interpolate variables
            <Switch checked={interpolate} onCheckedChange={setInterpolate} aria-label="Interpolate variables" />
          </Label>
        </div>

        {/* Code preview.
            min-h-[22rem] is load-bearing, not taste: DialogContent's
            `scrollable` gives the dialog `max-h-[85vh]` and no definite
            height, so this pane's `flex-1` resolved against an indefinite
            parent and collapsed to zero — the dialog rendered as a header and
            a toolbar with no code under it at all. A real minimum gives the
            CodeViewer inside something to fill; longer snippets scroll within
            it rather than growing the dialog. */}
        <div className="relative flex min-h-[22rem] flex-1 flex-col border-t">
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
