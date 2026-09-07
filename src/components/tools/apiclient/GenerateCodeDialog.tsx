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
      {/* `viewport` + a vh floor: a snippet is the one thing in this app that
          is strictly easier to read the more width it gets (fewer forced
          wraps in a long curl line), and at max-w-4xl this dialog used a
          fraction of a large window. The floor is a *min*, not a fixed
          height, so the dialog still grows with the snippet up to
          `scrollable`'s 85vh cap rather than jumping between sizes as you
          switch language or variant. */}
      <DialogContent size="viewport" scrollable className="min-h-[60vh]">
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

        {/* Code preview. The height floor that used to live here
            (`min-h-[22rem]`) was load-bearing — `scrollable` gives the dialog
            no definite height, so this pane's `flex-1` collapsed to zero and
            the dialog rendered as a header and a toolbar with no code under
            it. That floor now sits on the dialog itself as a viewport
            fraction, which fixes the same collapse *and* lets the pane grow
            with the window instead of stopping at a fixed 352px. */}
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
